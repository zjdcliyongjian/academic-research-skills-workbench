import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { SKILL_REGISTRY } from "./config.mjs";
import { store } from "./db.mjs";
import { appendApprovalEvent, appendRunEvent, saveRunDraft, updateCodexBinding } from "./vault.mjs";

const CLIENT_INFO = {
  name: "ai_research_copilot_workbench",
  title: "AI 科研工作台",
  version: "0.1.0",
};

const THREAD_DEVELOPER_INSTRUCTIONS = [
  "你在 AI 科研工作台中工作。",
  "原始资料目录只读；所有来源必须保留可追溯路径或 URL。",
  "明确区分来源事实、综合判断、冲突、未知项与待核验项。",
  "任何外部写入、命令执行、联网采集或覆盖正式成果都必须请求人工审批。",
].join("\n");

function threadOptions(project) {
  return {
    cwd: project.projectPath,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    personality: "pragmatic",
    developerInstructions: THREAD_DEVELOPER_INSTRUCTIONS,
  };
}

function isThreadNotFound(error) {
  return /thread not found/i.test(error instanceof Error ? error.message : String(error));
}

function isRunCancelled(run) {
  return !run || run.status === "cancelled" || Boolean(run.cancelRequestedAt);
}

function finalMessage(turn) {
  return [...(turn?.items || [])]
    .reverse()
    .find((item) => item.type === "agentMessage" && item.phase === "final_answer")?.text || "";
}

function approvalPayload(params = {}) {
  const command = params.command || params.item?.command || params.proposedCommand || null;
  return {
    reason: params.reason || params.rationale || "Codex 请求执行需要人工确认的操作",
    command,
    cwd: params.cwd || params.item?.cwd || null,
    raw: params,
  };
}

export class CodexBridge extends EventEmitter {
  constructor({ storeInstance = store, updateBinding = updateCodexBinding } = {}) {
    super();
    this.store = storeInstance;
    this.updateBinding = updateBinding;
    this.proc = null;
    this.pending = new Map();
    this.pendingApprovals = new Map();
    this.activeByThread = new Map();
    this.loadedThreads = new Set();
    this.skillMap = new Map();
    this.nextId = 1;
    this.ready = false;
    this.starting = false;
    this.error = null;
    this.initializeResult = null;
    this.account = null;
    this.stderrTail = [];
  }

  async start() {
    if (this.ready || this.starting) return;
    this.starting = true;
    this.error = null;
    try {
      this.proc = spawn(process.platform === "win32" ? "codex.exe" : "codex", ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.proc.on("error", (error) => this.fail(error));
      this.proc.on("exit", (code) => this.fail(new Error(`Codex App Server 已退出（${code ?? "unknown"}）`)));
      this.proc.stderr.on("data", (chunk) => {
        this.stderrTail.push(chunk.toString("utf8"));
        if (this.stderrTail.length > 20) this.stderrTail.shift();
      });
      const lines = createInterface({ input: this.proc.stdout });
      lines.on("line", (line) => this.handleLine(line));
      this.initializeResult = await this.request("initialize", { clientInfo: CLIENT_INFO });
      this.send({ method: "initialized", params: {} });
      const [account, skillResponse] = await Promise.all([
        this.request("account/read", {}).catch(() => this.request("account/get", {}).catch(() => null)),
        this.request("skills/list", { cwds: [process.cwd()], forceReload: true }),
      ]);
      this.account = account?.account || account;
      const discovered = (skillResponse?.data || []).flatMap((entry) => entry.skills || []);
      this.skillMap = new Map(discovered.map((skill) => [skill.name, skill]));
      this.ready = true;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.starting = false;
    }
  }

  fail(error) {
    this.ready = false;
    this.starting = false;
    this.error = error instanceof Error ? error.message : String(error);
    this.loadedThreads.clear();
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  send(message) {
    if (!this.proc?.stdin?.writable) throw new Error("Codex App Server 尚未连接");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, 60_000);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.send({ id, method, params });
    });
  }

  async handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && ("result" in message || "error" in message)) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      await this.handleServerRequest(message);
      return;
    }
    if (message.method) await this.handleNotification(message);
  }

  async handleServerRequest(message) {
    const runId = this.activeByThread.get(message.params?.threadId);
    if (!runId) {
      this.send({ id: message.id, result: { decision: "decline" } });
      return;
    }
    const run = this.store.getRun(runId);
    const project = run ? this.store.getProject(run.projectId) : null;
    if (!run || !project || isRunCancelled(run)) {
      this.send({ id: message.id, result: { decision: "decline" } });
      return;
    }
    const approvalId = randomUUID();
    const payload = approvalPayload(message.params);
    const approval = this.store.createApproval({
      id: approvalId,
      projectId: project.id,
      runId,
      method: message.method,
      status: "pending",
      payload,
      createdAt: new Date().toISOString(),
    });
    this.store.updateRun(runId, { status: "waiting_approval" });
    this.pendingApprovals.set(approvalId, { rpcId: message.id, runId });
    await appendApprovalEvent(project, { type: "requested", ...approval, payload });
    this.emitRun(runId, { type: "approval", approval, run: this.store.getRun(runId) });
  }

  async handleNotification(message) {
    const params = message.params || {};
    const runId = this.activeByThread.get(params.threadId);
    if (!runId) return;
    const run = this.store.getRun(runId);
    const project = run ? this.store.getProject(run.projectId) : null;
    if (!run || !project) return;
    // Cancellation is a terminal local decision. Late App Server events must
    // never resurrect a cancelled run or append output after the user stopped it.
    if (isRunCancelled(run)) {
      if (message.method === "turn/completed") this.activeByThread.delete(params.threadId);
      return;
    }
    if (message.method === "turn/started") {
      const updated = this.store.updateRun(runId, { turnId: params.turn?.id || params.turnId || null, status: "running" });
      this.emitRun(runId, { type: "run", run: updated });
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      const updated = this.store.updateRun(runId, { output: `${run.output || ""}${params.delta || ""}` });
      this.emitRun(runId, { type: "delta", delta: params.delta || "", run: updated });
      return;
    }
    if (message.method === "turn/completed") {
      const latestRun = this.store.getRun(runId);
      const interrupted = params.turn?.status === "interrupted";
      const status = params.turn?.status === "completed" ? "completed" : interrupted && latestRun?.cancelRequestedAt ? "cancelled" : "failed";
      const output = finalMessage(params.turn) || this.store.getRun(runId)?.output || "";
      const updated = this.store.updateRun(runId, {
        status,
        output,
        error: params.turn?.error?.message || null,
        completedAt: new Date().toISOString(),
      });
      const artifactPath = await saveRunDraft(project, updated);
      const saved = this.store.updateRun(runId, { artifactPath });
      await appendRunEvent(project, { type: `run.${status}`, run: saved });
      this.activeByThread.delete(params.threadId);
      this.emitRun(runId, { type: status, run: saved });
    }
  }

  emitRun(runId, event) {
    this.emit(`run:${runId}`, event);
  }

  async createThread(project) {
    await this.start();
    const response = await this.request("thread/start", {
      ...threadOptions(project),
      threadSource: "ai_research_copilot_workbench",
    });
    const threadId = response?.thread?.id;
    if (!threadId) throw new Error("Codex 未返回任务 ID");
    this.loadedThreads.add(threadId);
    await this.request("thread/name/set", { threadId, name: `科研工作台｜${project.name}` });
    return threadId;
  }

  async resumeThread(project) {
    if (!project.threadId) throw new Error("项目尚未绑定 Codex 任务");
    await this.request("thread/resume", {
      threadId: project.threadId,
      ...threadOptions(project),
      excludeTurns: true,
    });
    this.loadedThreads.add(project.threadId);
    return project.threadId;
  }

  async replaceThread(project, runId) {
    if (project.threadId) this.loadedThreads.delete(project.threadId);
    const threadId = await this.createThread(project);
    const updatedProject = this.store.updateProjectThread(project.id, threadId);
    await this.updateBinding(updatedProject, threadId);
    if (runId) this.store.updateRun(runId, { threadId });
    return { project: updatedProject, threadId };
  }

  async ensureThread(project, runId) {
    await this.start();
    if (!project.threadId) return this.replaceThread(project, runId);
    if (this.loadedThreads.has(project.threadId)) return { project, threadId: project.threadId };
    try {
      await this.resumeThread(project);
      return { project, threadId: project.threadId };
    } catch (error) {
      if (!isThreadNotFound(error)) throw error;
      return this.replaceThread(project, runId);
    }
  }

  async startSkill({ runId, project, skillName, prompt }) {
    await this.start();
    const skill = this.skillMap.get(skillName);
    if (!skill?.enabled || !skill?.path) throw new Error(`Skill 未发现或未启用：${skillName}`);
    if (isRunCancelled(this.store.getRun(runId))) return { cancelled: true, threadId: project.threadId, turnId: null };
    let resolved = await this.ensureThread(project, runId);
    let threadId = resolved.threadId;
    if (isRunCancelled(this.store.getRun(runId))) return { cancelled: true, threadId, turnId: null };
    this.activeByThread.set(threadId, runId);
    const startTurn = () => this.request("turn/start", {
      threadId,
      input: [
        { type: "skill", name: skill.name, path: skill.path },
        { type: "text", text: prompt },
      ],
    });
    let turn;
    try {
      turn = await startTurn();
    } catch (error) {
      this.activeByThread.delete(threadId);
      if (!isThreadNotFound(error)) throw error;
      resolved = await this.replaceThread(resolved.project, runId);
      threadId = resolved.threadId;
      this.activeByThread.set(threadId, runId);
      try {
        turn = await startTurn();
      } catch (retryError) {
        this.activeByThread.delete(threadId);
        throw retryError;
      }
    }
    const turnId = turn?.turn?.id || null;
    const latestRun = this.store.getRun(runId);
    if (isRunCancelled(latestRun)) {
      if (turnId) {
        await this.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
      this.activeByThread.delete(threadId);
      return { cancelled: true, threadId, turnId };
    }
    this.store.updateRun(runId, { threadId, turnId, status: "running" });
    return { threadId, turnId };
  }

  async resolveApproval(approvalId, decision) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) throw new Error("审批请求已失效或已处理");
    this.send({ id: pending.rpcId, result: { decision } });
    this.pendingApprovals.delete(approvalId);
    const approval = this.store.resolveApproval(approvalId, decision);
    // Declining one tool request does not decline the whole Codex turn. The
    // model can continue with a safer fallback and will publish the final turn
    // status through the normal completion event.
    const run = this.store.updateRun(pending.runId, { status: "running" });
    const project = this.store.getProject(run.projectId);
    await appendApprovalEvent(project, { type: "resolved", approval, runId: run.id });
    this.emitRun(run.id, { type: "approval_resolved", approval, run });
    return { approval, run };
  }

  async cancelRun(runId) {
    const run = this.store.getRun(runId);
    if (!run) throw new Error("运行记录不存在");
    if (!["queued", "running", "waiting_approval"].includes(run.status)) {
      return { run, alreadyFinished: true };
    }
    const cancelRequestedAt = new Date().toISOString();
    const requested = this.store.updateRun(runId, { cancelRequestedAt });
    const project = this.store.getProject(run.projectId);
    await appendRunEvent(project, { type: "run.cancel_requested", run: requested });
    if (run.turnId) {
      await this.request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId });
    }
    // turn/interrupt only acknowledges the request. Persist cancellation here
    // instead of waiting for a later notification, otherwise duplicate legacy
    // records that point at the same turn can remain stuck as "running".
    const related = this.store.listRuns(run.projectId).filter((item) =>
      ["queued", "running", "waiting_approval"].includes(item.status)
      && (item.id === runId || (run.turnId && item.threadId === run.threadId && item.turnId === run.turnId))
    );
    const relatedIds = new Set(related.map((item) => item.id));
    for (const [approvalId, pending] of this.pendingApprovals.entries()) {
      if (!relatedIds.has(pending.runId)) continue;
      this.send({ id: pending.rpcId, result: { decision: "cancel" } });
      this.pendingApprovals.delete(approvalId);
      this.store.resolveApproval(approvalId, "cancel");
    }
    let requestedRun = null;
    for (const item of related) {
      const cancelled = this.store.updateRun(item.id, { status: "cancelled", completedAt: cancelRequestedAt });
      const artifactPath = await saveRunDraft(project, cancelled);
      const saved = this.store.updateRun(item.id, { artifactPath });
      await appendRunEvent(project, { type: "run.cancelled", run: saved });
      this.emitRun(item.id, { type: "cancelled", run: saved });
      if (item.id === runId) requestedRun = saved;
    }
    if (relatedIds.has(this.activeByThread.get(run.threadId))) this.activeByThread.delete(run.threadId);
    return { run: requestedRun || this.store.getRun(runId), alreadyFinished: false, relatedRunIds: [...relatedIds] };
  }

  health() {
    const items = SKILL_REGISTRY.map((entry) => {
      const skill = this.skillMap.get(entry.name);
      return { ...entry, found: Boolean(skill), enabled: Boolean(skill?.enabled), path: skill?.path || null };
    });
    return {
      status: this.ready ? "ready" : this.starting ? "starting" : "unavailable",
      authenticated: Boolean(this.account),
      accountType: this.account?.type || this.account?.planType || null,
      error: this.error,
      items,
      totalDiscovered: this.skillMap.size,
      warning: this.skillMap.size > 100 ? "已发现较多 Skill，工作台运行时仅显式附加当前阶段所需 Skill。" : null,
    };
  }

  stop() {
    this.proc?.kill();
  }
}

export const codex = new CodexBridge();
