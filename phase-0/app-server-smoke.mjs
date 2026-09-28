import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EXPECTED_SKILLS = [
  "idea-evaluator",
  "deep-research",
  "tech-paper-template",
  "benchmark-paper-template",
  "intro-drafter",
  "paper-writer",
  "paper-polish",
  "figure-designer",
  "drawio-reconstruction",
  "pre-submission-reviewer",
  "rebuttal-guidance",
  "vibe-research-workflow",
];

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const workbenchRoot = path.resolve(
  getArg("--cwd", path.join(import.meta.dirname, "sandbox-project")),
);
const evidenceDir = path.resolve(
  getArg("--evidence", path.join(import.meta.dirname, "evidence")),
);
const codexBin = getArg("--codex", process.platform === "win32" ? "codex.exe" : "codex");
const timeoutMs = Number(getArg("--timeout", "180000"));

await mkdir(workbenchRoot, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const startedAt = new Date();
const proc = spawn(codexBin, ["app-server", "--listen", "stdio://"], {
  cwd: workbenchRoot,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const rl = createInterface({ input: proc.stdout });
const pending = new Map();
const notifications = [];
const serverRequests = [];
const stderr = [];
let nextId = 1;
let turnCompletion = null;
let resolveTurnCompletion;
const turnCompletedPromise = new Promise((resolve) => {
  resolveTurnCompletion = resolve;
});

const timeout = setTimeout(() => {
  for (const { reject } of pending.values()) {
    reject(new Error(`App Server request exceeded ${timeoutMs} ms`));
  }
  pending.clear();
  resolveTurnCompletion?.({ timeout: true });
  proc.kill();
}, timeoutMs);

const send = (message) => {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
};

const request = (method, params = {}) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { method, resolve, reject });
    send({ method, id, params });
  });
};

proc.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
proc.on("error", (error) => {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
  resolveTurnCompletion?.({ error: error.message });
});

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    notifications.push({ method: "protocol/non-json-line", params: { line } });
    return;
  }

  if (message.id != null && ("result" in message || "error" in message)) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
    } else {
      waiter.resolve(message.result);
    }
    return;
  }

  if (message.id != null && message.method) {
    serverRequests.push(message);
    // The smoke turn is read-only and should not need approval. If the server
    // nevertheless asks, fail closed so the test cannot mutate user data.
    send({ id: message.id, result: { decision: "decline" } });
    return;
  }

  if (message.method) {
    notifications.push(message);
    if (message.method === "turn/completed") {
      turnCompletion = message.params;
      resolveTurnCompletion(message.params);
    }
  }
});

let exitCode = 1;
try {
  const initialize = await request("initialize", {
    clientInfo: {
      name: "ai_research_copilot_workbench",
      title: "AI Research Copilot Workbench",
      version: "0.0.1-phase0",
    },
  });
  send({ method: "initialized", params: {} });

  const skillsResponse = await request("skills/list", {
    cwds: [workbenchRoot],
    forceReload: true,
  });
  const entries = Array.isArray(skillsResponse?.data) ? skillsResponse.data : [];
  const skills = entries.flatMap((entry) => entry.skills ?? []);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const expected = EXPECTED_SKILLS.map((name) => ({
    name,
    found: byName.has(name),
    enabled: byName.get(name)?.enabled ?? false,
    path: byName.get(name)?.path ?? null,
    scope: byName.get(name)?.scope ?? null,
  }));
  const missing = expected.filter((skill) => !skill.found || !skill.enabled);
  if (missing.length) {
    throw new Error(`Expected skills missing or disabled: ${missing.map((s) => s.name).join(", ")}`);
  }

  const selectedSkill = byName.get("idea-evaluator");
  const threadStart = await request("thread/start", {
    cwd: workbenchRoot,
    sandbox: "read-only",
    approvalPolicy: "never",
    personality: "pragmatic",
    developerInstructions:
      "This is a local protocol smoke test. Do not use tools, browse the web, or modify files.",
    threadSource: "ai_research_copilot_workbench",
  });
  const threadId = threadStart?.thread?.id;
  if (!threadId) throw new Error("thread/start returned no thread id");

  await request("thread/name/set", {
    threadId,
    name: "AI科研副导师工作台｜阶段0连接验证",
  });

  const turnStart = await request("turn/start", {
    threadId,
    input: [
      {
        type: "skill",
        name: selectedSkill.name,
        path: selectedSkill.path,
      },
      {
        type: "text",
        text:
          "这是阶段0协议验证。不要评价研究主题，不要调用工具，不要联网。仅确认已读取附加 Skill，并输出一行 JSON：skill、loaded、output_sections，其中 output_sections 是该 Skill 最终输出格式的七个一级小节英文标题。",
      },
    ],
  });

  await turnCompletedPromise;
  if (turnCompletion?.timeout) throw new Error("Turn did not complete before timeout");
  if (turnCompletion?.turn?.status && turnCompletion.turn.status !== "completed") {
    throw new Error(`Turn completed with status ${turnCompletion.turn.status}`);
  }

  const threadRead = await request("thread/read", {
    threadId,
    includeTurns: false,
  });

  const evidence = {
    test: "Codex App Server + Supervisor-Skills phase-0 smoke test",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      node: process.version,
      codexBin,
      cwd: workbenchRoot,
      transport: "stdio://",
    },
    initialize,
    skills: {
      totalDiscovered: skills.length,
      expected,
      errors: entries.flatMap((entry) => entry.errors ?? []),
    },
    thread: {
      id: threadId,
      start: threadStart,
      turnStart,
      read: threadRead,
    },
    stream: {
      notificationCount: notifications.length,
      methods: [...new Set(notifications.map((item) => item.method))],
      notifications,
      turnCompletion,
    },
    approvals: {
      unexpectedRequestCount: serverRequests.length,
      requests: serverRequests,
    },
    stderr,
    result: "PASS",
  };

  const evidencePath = path.join(evidenceDir, "app-server-smoke-result.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    result: "PASS",
    evidencePath,
    threadId,
    skillsExpected: expected.length,
    skillsFoundAndEnabled: expected.filter((skill) => skill.found && skill.enabled).length,
    notificationMethods: evidence.stream.methods,
    unexpectedApprovals: serverRequests.length,
  }, null, 2));
  exitCode = 0;
} catch (error) {
  const failure = {
    test: "Codex App Server + Supervisor-Skills phase-0 smoke test",
    startedAt: startedAt.toISOString(),
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack : String(error),
    notifications,
    serverRequests,
    stderr,
    result: "FAIL",
  };
  const evidencePath = path.join(evidenceDir, "app-server-smoke-result.json");
  await writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(failure.error);
} finally {
  clearTimeout(timeout);
  rl.close();
  proc.kill();
  process.exitCode = exitCode;
}
