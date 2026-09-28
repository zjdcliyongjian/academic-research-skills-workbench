import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, DEFAULT_VAULT_ROOT, DIST_DIR, HOST, MAX_SOURCE_BYTES, PORT, SKILL_REGISTRY } from "./config.mjs";
import { store } from "./db.mjs";
import { codex } from "./codex-bridge.mjs";
import { exportDocx, exportMarkdown } from "./export.mjs";
import { exportBibtex, exportLatex } from "./stage2-export.mjs";
import { deleteExportFile, downloadExportFile, listExportFiles, previewExportFile } from "./export-library.mjs";
import { buildPrompt } from "./prompts.mjs";
import { buildRetryPrompt } from "./run-prompts.mjs";
import { assertReviewableRun, stageForSkill } from "./research-state.mjs";
import { appendRunEvent, appendSourceLedger, appendStageReview, appendVersionEvent, assertInside, createProjectSpace, createSourceId, ensureStage15ProjectLayout, exists, initializeVault, moveToProjectTrash, safeSegment, saveSourceFile, saveStageVersion, updateCodexBinding, updateProjectProfile } from "./vault.mjs";
import { downloadSource, previewSource, processSource, quoteHash } from "./source-processing.mjs";
import { buildProjectReadiness } from "./trial-readiness.mjs";
import { exportDeliveryPackage } from "./delivery-package.mjs";
import { clearLocalResearchData } from "./data-management.mjs";

const execFileAsync = promisify(execFile);
const VERSION = "0.4.1-local";
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

async function jsonBody(req, max = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function bufferBody(req, max = MAX_SOURCE_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("单个资料不能超过 50MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function sendBuffer(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Length": body.length, "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function requireProject(id) {
  const project = store.getProject(id);
  if (!project) { const error = new Error("项目不存在"); error.status = 404; throw error; }
  return project;
}

function assertNoActiveProjectRun(projectId) {
  const active = store.listRuns(projectId).find((run) => ["queued", "running", "waiting_approval"].includes(run.status));
  if (!active) return;
  const error = new Error("当前课题已有任务正在运行、排队或等待审批，请先完成或取消该任务");
  error.status = 409;
  throw error;
}

function assertProjectActive(project) {
  if (project.status === "active") return;
  const error = new Error(project.status === "completed" ? "课题已完成；如需继续运行，请先在课题设置中恢复为进行中" : "课题已暂停；请先在课题设置中恢复为进行中");
  error.status = 409;
  throw error;
}

function userMessageForInput(skillName, input = {}) {
  if (skillName === "idea-evaluator") return String(input.idea || "").trim() || "评估当前研究构想";
  return String(input.instructions || "").trim() || "按当前 Skill 的标准流程形成可审阅草稿";
}

async function startLinkedRun(project, sourceRun, executionPrompt, userMessage) {
  assertProjectActive(project);
  assertNoActiveProjectRun(project.id);
  let workingProject = project;
  if (!workingProject.threadId) {
    const threadId = await codex.createThread(workingProject);
    workingProject = store.updateProjectThread(workingProject.id, threadId);
    await updateCodexBinding(workingProject, threadId);
  }
  const run = store.createRun({
    id: randomUUID(),
    projectId: workingProject.id,
    skillName: sourceRun.skillName,
    threadId: workingProject.threadId,
    turnId: null,
    status: "queued",
    prompt: userMessage,
    output: "",
    parentRunId: sourceRun.id,
    reviewStatus: "pending",
    startedAt: new Date().toISOString(),
  });
  await appendRunEvent(workingProject, { type: "run.queued", run });
  codex.startSkill({ runId: run.id, project: workingProject, skillName: run.skillName, prompt: executionPrompt }).catch(async (error) => {
    const failed = store.updateRun(run.id, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
    await appendRunEvent(workingProject, { type: "run.failed", run: failed });
    codex.emitRun(run.id, { type: "failed", run: failed });
  });
  return run;
}

async function reviewCompletedRun(run, decision, note = "") {
  assertReviewableRun(run);
  const project = requireProject(run.projectId);
  if (decision === "request_revision") assertProjectActive(project);
  const stage = stageForSkill(run.skillName);
  const reviewedAt = new Date().toISOString();
  if (["reject", "request_revision"].includes(decision) && !note.trim()) {
    throw new Error(decision === "reject" ? "驳回时必须填写原因" : "要求修改时必须填写修改要求");
  }

  if (decision === "adopt") {
    const versionNumber = (store.listStageVersions(project.id, stage)[0]?.versionNumber || 0) + 1;
    const saved = await saveStageVersion(project, run, stage, versionNumber, reviewedAt);
    const result = store.activateStageVersion({
      id: randomUUID(),
      projectId: project.id,
      stage,
      versionNumber,
      runId: run.id,
      skillName: run.skillName,
      relativePath: saved.relativePath,
      contentSha256: saved.contentSha256,
      adoptedAt: saved.adoptedAt,
      reviewNote: note.trim() || null,
    });
    const event = { type: "review.adopted", decision, note: note.trim() || null, reviewedAt, run: store.getRun(run.id), version: result.version };
    await appendStageReview(project, stage, event);
    await appendVersionEvent(project, { type: "version.activated", version: result.version, impactedStages: result.impactedStages });
    await appendRunEvent(project, event);
    return { run: store.getRun(run.id), version: result.version, project: result.project, impactedStages: result.impactedStages };
  }

  const reviewed = store.reviewRun(run.id, decision, note.trim(), reviewedAt);
  const eventType = decision === "reject" ? "review.rejected" : "review.revision_requested";
  const event = { type: eventType, decision, note: note.trim(), reviewedAt, run: reviewed };
  await appendStageReview(project, stage, event);
  await appendRunEvent(project, event);
  if (decision === "request_revision") {
    const executionPrompt = `用户针对上一版草稿提出以下修改要求：\n${note.trim()}\n\n上一版草稿：\n${run.output || "[上一版无完整输出]"}\n\n请保留有证据支持的内容，逐项回应修改要求，并输出一个完整的新版本。`;
    const nextRun = await startLinkedRun(project, run, executionPrompt, note.trim());
    return { run: reviewed, nextRun, project: store.getProject(project.id) };
  }
  return { run: reviewed, project: store.getProject(project.id) };
}

async function cliVersion() {
  try { return (await execFileAsync(process.platform === "win32" ? "codex.exe" : "codex", ["--version"], { windowsHide: true })).stdout.trim(); }
  catch { return null; }
}

async function deepLinkRegistered() {
  if (process.platform !== "win32") return false;
  try { await execFileAsync("reg.exe", ["query", "HKCR\\codex", "/ve"], { windowsHide: true }); return true; }
  catch { return false; }
}

async function vaultHealth() {
  try {
    await initializeVault(DEFAULT_VAULT_ROOT);
    const probe = path.join(DEFAULT_VAULT_ROOT, "99-系统", `.write-probe-${process.pid}`);
    await writeFile(probe, "ok", "utf8");
    await rm(probe, { force: true });
    return { root: DEFAULT_VAULT_ROOT, exists: true, writable: true };
  } catch {
    return { root: DEFAULT_VAULT_ROOT, exists: await exists(DEFAULT_VAULT_ROOT), writable: false };
  }
}

async function healthPayload() {
  const [version, registered, vault] = await Promise.all([cliVersion(), deepLinkRegistered(), vaultHealth()]);
  const ch = codex.health();
  return {
    app: { status: "ready", version: VERSION, port: PORT },
    codex: { status: ch.status, cliVersion: version, authenticated: ch.authenticated, accountType: ch.accountType, transport: "stdio://", error: ch.error },
    skills: { expected: SKILL_REGISTRY.length, ready: ch.items.filter((item) => item.found && item.enabled).length, totalDiscovered: ch.totalDiscovered, items: ch.items, warning: ch.warning },
    vault,
    deepLink: { registered, template: "codex://threads/{thread_id}" },
    database: store.diagnostics(),
  };
}

async function routeApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, await healthPayload());
  if (req.method === "DELETE" && url.pathname === "/api/account/research-data") {
    return sendJson(res, 200, await clearLocalResearchData(store));
  }
  if (req.method === "POST" && url.pathname === "/api/system/backup") {
    return sendJson(res, 201, { path: store.createBackup(), createdAt: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/feedback") return sendJson(res, 200, { items: store.listProductFeedback() });
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const input = await jsonBody(req);
    const category = String(input.category || "").trim();
    const title = String(input.title || "").trim();
    const details = String(input.details || "").trim();
    if (!['bug', 'feature', 'question', 'other'].includes(category)) throw new Error("无效的反馈类型");
    if (!title || !details) throw new Error("反馈标题和详细说明不能为空");
    if (title.length > 120 || details.length > 5000) throw new Error("反馈内容超过长度上限");
    const item = store.createProductFeedback({
      id: randomUUID(), projectId: input.projectId || null, category, title, details,
      reproduction: String(input.reproduction || "").trim(), expected: String(input.expected || "").trim(),
      contact: String(input.contact || "").trim(), context: input.context || {},
      status: "submitted", createdAt: new Date().toISOString(),
    });
    return sendJson(res, 201, { item });
  }
  if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, { projects: store.listProjects() });
  if (req.method === "POST" && url.pathname === "/api/projects") {
    const input = await jsonBody(req);
    if (!input.name?.trim() || !input.field?.trim() || !input.goal?.trim()) throw new Error("项目名称、领域和研究目标不能为空");
    const now = new Date().toISOString();
    const draft = { id: randomUUID(), name: input.name.trim(), slug: safeSegment(input.name), field: input.field.trim(), goal: input.goal.trim(), language: input.language || "zh", paperType: input.paperType || "general", status: "active", stage: "brief", vaultRoot: DEFAULT_VAULT_ROOT, projectPath: "", threadId: null, createdAt: now, updatedAt: now };
    draft.projectPath = await createProjectSpace(DEFAULT_VAULT_ROOT, draft);
    let project = store.createProject(draft);
    let codexWarning;
    try {
      const threadId = await codex.createThread(project);
      project = store.updateProjectThread(project.id, threadId);
      await updateCodexBinding(project, threadId);
    } catch (error) { codexWarning = error.message; }
    return sendJson(res, 201, { project, codexWarning });
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
    let project = requireProject(parts[2]);
    if (req.method === "GET" && parts.length === 3) {
      await ensureStage15ProjectLayout(project);
      const sources = store.listSources(project.id);
      const evidenceClaims = store.listEvidenceClaims(project.id);
      const runs = store.listRuns(project.id);
      const versions = store.listStageVersions(project.id);
      return sendJson(res, 200, { project, sources, evidenceClaims, runs, approvals: store.listPendingApprovals(project.id), versions, readiness: buildProjectReadiness(project, sources, evidenceClaims, runs, versions) });
    }
    if (req.method === "PATCH" && parts.length === 3) {
      const input = await jsonBody(req);
      const patch = {
        name: String(input.name || "").trim(),
        field: String(input.field || "").trim(),
        goal: String(input.goal || "").trim(),
        language: input.language,
        paperType: input.paperType,
        status: input.status,
      };
      if (!patch.name || !patch.field || !patch.goal) throw new Error("课题名称、领域和研究目标不能为空");
      if (!["zh", "en", "bilingual"].includes(patch.language)) throw new Error("无效的输出语言");
      if (!["general", "technical", "benchmark"].includes(patch.paperType)) throw new Error("无效的论文类型");
      if (!["active", "paused", "completed"].includes(patch.status)) throw new Error("无效的项目状态");
      if (patch.status !== "active" && store.listRuns(project.id).some((run) => ["queued", "running", "waiting_approval"].includes(run.status))) {
        const error = new Error("课题仍有运行中或待审批任务，请先完成或取消任务再暂停/完成课题");
        error.status = 409;
        throw error;
      }
      project = store.updateProject(project.id, patch);
      await updateProjectProfile(project);
      await appendRunEvent(project, { type: "project.updated", changed: Object.keys(patch), createdAt: new Date().toISOString() });
      return sendJson(res, 200, { project });
    }
    if (req.method === "POST" && parts[3] === "sources" && parts.length === 4) {
      const fileName = url.searchParams.get("name") || "source";
      const saved = await saveSourceFile(project, fileName, await bufferBody(req));
      const source = store.createSource({ id: createSourceId(), projectId: project.id, name: fileName, kind: "file", relativePath: saved.relativePath, sha256: saved.sha256, size: saved.size, url: null, status: "raw", createdAt: new Date().toISOString() });
      await appendSourceLedger(project, source);
      return sendJson(res, 201, { source });
    }
    if (req.method === "POST" && parts[3] === "sources" && parts[4] === "url") {
      const body = await jsonBody(req);
      const parsed = new URL(body.url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("只支持 HTTP 或 HTTPS 地址");
      const source = store.createSource({ id: createSourceId(), projectId: project.id, name: parsed.hostname + parsed.pathname, kind: "url", relativePath: null, sha256: null, size: null, url: parsed.toString(), status: "raw", createdAt: new Date().toISOString() });
      await appendSourceLedger(project, source);
      return sendJson(res, 201, { source });
    }
    if (req.method === "DELETE" && parts[3] === "sources" && parts[4] && parts.length === 5) {
      const source = store.getSource(parts[4]);
      if (!source || source.projectId !== project.id) return sendJson(res, 404, { error: "来源不存在" });
      const deleted = store.deleteSource(source.id);
      const paths = [source.relativePath, source.snapshotPath, source.extractedPath, `02-sources/metadata/${source.id}.json`];
      const trashPaths = [];
      for (const relativePath of paths) {
        const moved = await moveToProjectTrash(project, relativePath, "sources");
        if (moved) trashPaths.push(moved);
      }
      await appendRunEvent(project, { type: "source.deleted", sourceId: source.id, name: source.title || source.name, trashPaths, createdAt: new Date().toISOString() });
      return sendJson(res, 200, { deleted: Boolean(deleted), trashPaths });
    }
    if (parts[3] === "sources" && parts[4] && parts[5] === "process" && req.method === "POST") {
      const source = store.getSource(parts[4]);
      if (!source || source.projectId !== project.id) return sendJson(res, 404, { error: "来源不存在" });
      store.updateSource(source.id, { processingStatus: "processing", failureReason: null });
      try {
        const processed = await processSource(project, source);
        const normalizeTitle = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        const duplicates = store.listSources(project.id).filter((item) => item.id !== source.id && (
          (processed.doi && item.doi?.toLowerCase() === processed.doi.toLowerCase()) ||
          (processed.sha256 && item.sha256 === processed.sha256) ||
          (processed.title && item.title && processed.publicationYear && item.publicationYear === processed.publicationYear && normalizeTitle(item.title) === normalizeTitle(processed.title))
        ));
        const updated = store.updateSource(source.id, { ...processed, processingStatus: duplicates.length ? "duplicate_candidate" : processed.processingStatus });
        await appendRunEvent(project, { type: "source.processed", source: updated, duplicateSourceIds: duplicates.map((item) => item.id), createdAt: new Date().toISOString() });
        return sendJson(res, 200, { source: updated, duplicates });
      } catch (error) {
        const failed = store.updateSource(source.id, { processingStatus: "failed", failureReason: error.message, processedAt: new Date().toISOString() });
        await appendRunEvent(project, { type: "source.failed", source: failed, error: error.message, createdAt: new Date().toISOString() });
        throw error;
      }
    }
    if (parts[3] === "sources" && parts[4] && parts[5] === "preview" && req.method === "GET") {
      const source = store.getSource(parts[4]);
      if (!source || source.projectId !== project.id) return sendJson(res, 404, { error: "来源不存在" });
      return sendJson(res, 200, await previewSource(project, source));
    }
    if (parts[3] === "sources" && parts[4] && parts[5] === "download" && req.method === "GET") {
      const source = store.getSource(parts[4]);
      if (!source || source.projectId !== project.id) return sendJson(res, 404, { error: "来源不存在" });
      const file = await downloadSource(project, source, url.searchParams.get("kind") || "original");
      const encoded = encodeURIComponent(file.name).replaceAll("'", "%27");
      return sendBuffer(res, 200, file.buffer, { "Content-Type": file.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encoded}` });
    }
    if (parts[3] === "sources" && parts[4] && parts[5] === "verify" && req.method === "POST") {
      const source = store.getSource(parts[4]);
      if (!source || source.projectId !== project.id) return sendJson(res, 404, { error: "来源不存在" });
      const body = await jsonBody(req);
      if (!["metadata", "content", "reject"].includes(body.scope)) throw new Error("无效的核验范围");
      if (body.scope === "content" && source.status !== "metadata-verified") throw new Error("请先确认元数据，再确认正文内容");
      const now = new Date().toISOString();
      const metadata = body.metadata && typeof body.metadata === "object" ? {
        title: String(body.metadata.title || "").trim() || source.title,
        authors: Array.isArray(body.metadata.authors) ? body.metadata.authors.map((item) => String(item).trim()).filter(Boolean) : source.authors,
        publicationYear: Number(body.metadata.publicationYear) || source.publicationYear,
        venue: String(body.metadata.venue || "").trim() || null,
        doi: String(body.metadata.doi || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") || null,
      } : {};
      const patch = body.scope === "metadata"
        ? { ...metadata, status: "metadata-verified", processingStatus: "metadata_verified", metadataVerifiedAt: now }
        : body.scope === "content"
          ? { status: "content-verified", processingStatus: "content_verified", metadataVerifiedAt: source.metadataVerifiedAt || now }
          : { status: "rejected", processingStatus: "rejected", failureReason: body.note || "用户拒绝采用该来源" };
      const updated = store.updateSource(source.id, patch);
      await appendRunEvent(project, { type: "source.verified", scope: body.scope, note: body.note || null, source: updated, createdAt: now });
      return sendJson(res, 200, { source: updated });
    }
    if (parts[3] === "evidence" && parts.length === 4 && req.method === "POST") {
      const body = await jsonBody(req);
      if (!["source_fact", "synthesis", "inference", "unknown"].includes(body.claimType)) throw new Error("无效的证据类型");
      if (!body.claimText?.trim()) throw new Error("证据主张不能为空");
      const source = body.sourceId ? store.getSource(body.sourceId) : null;
      if (body.sourceId && (!source || source.projectId !== project.id)) throw new Error("关联来源不存在");
      if (body.claimType === "source_fact" && !source) throw new Error("来源事实必须关联来源");
      if (body.claimType === "source_fact" && source.status !== "content-verified") throw new Error("来源事实只能关联已人工确认内容的来源");
      if (body.claimType === "source_fact" && !body.locator?.trim()) throw new Error("来源事实必须填写页码、章节或段落定位");
      const claim = store.createEvidenceClaim({ id: randomUUID(), projectId: project.id, sourceId: source?.id || null, claimType: body.claimType, claimText: body.claimText.trim(), locator: body.locator?.trim() || null, quoteText: body.quoteText?.trim() || null, quoteSha256: quoteHash(body.quoteText?.trim()), verificationStatus: "pending", note: body.note?.trim() || null, createdAt: new Date().toISOString() });
      const target = path.join(project.projectPath, "02-sources", "evidence-cards", "evidence.jsonl");
      await mkdir(path.dirname(target), { recursive: true });
      await appendFile(target, `${JSON.stringify(claim)}\n`, "utf8");
      return sendJson(res, 201, { claim });
    }
    if (req.method === "POST" && parts[3] === "runs" && parts[4]) {
      const skillName = parts[4];
      if (!SKILL_REGISTRY.some((item) => item.name === skillName)) throw new Error("当前 Skill 不在阶段白名单中");
      assertProjectActive(project);
      assertNoActiveProjectRun(project.id);
      const input = await jsonBody(req);
      let workingProject = project;
      if (!workingProject.threadId) {
        const threadId = await codex.createThread(workingProject);
        workingProject = store.updateProjectThread(workingProject.id, threadId);
        await updateCodexBinding(workingProject, threadId);
      }
      const executionPrompt = buildPrompt(workingProject, skillName, input);
      const run = store.createRun({ id: randomUUID(), projectId: project.id, skillName, threadId: workingProject.threadId, turnId: null, status: "queued", prompt: userMessageForInput(skillName, input), output: "", reviewStatus: "pending", startedAt: new Date().toISOString() });
      await appendRunEvent(workingProject, { type: "run.queued", run });
      codex.startSkill({ runId: run.id, project: workingProject, skillName, prompt: executionPrompt }).catch(async (error) => {
        const failed = store.updateRun(run.id, { status: "failed", error: error.message, completedAt: new Date().toISOString() });
        await appendRunEvent(workingProject, { type: "failed", run: failed });
        codex.emitRun(run.id, { type: "failed", run: failed });
      });
      return sendJson(res, 202, { run: store.getRun(run.id) });
    }
    if (req.method === "GET" && parts[3] === "versions" && parts.length === 4) {
      return sendJson(res, 200, { versions: store.listStageVersions(project.id, url.searchParams.get("stage")) });
    }
    if (req.method === "GET" && parts[3] === "versions" && parts[4]) {
      const version = store.getStageVersion(parts[4]);
      if (!version || version.projectId !== project.id) return sendJson(res, 404, { error: "正式版本不存在" });
      const target = assertInside(project.projectPath, path.join(project.projectPath, version.relativePath));
      return sendJson(res, 200, { version, content: await readFile(target, "utf8") });
    }
    if (req.method === "POST" && parts[3] === "open-codex") {
      if (!project.threadId) throw new Error("该项目尚未绑定 Codex 任务");
      const uri = `codex://threads/${encodeURIComponent(project.threadId)}`;
      if (process.platform === "win32") await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${uri}'`], { windowsHide: true });
      else throw new Error("当前系统暂不支持一键打开 Codex Desktop");
      return sendJson(res, 200, { opened: true, uri });
    }
    if (req.method === "GET" && parts[3] === "exports" && parts.length === 4) {
      return sendJson(res, 200, { files: await listExportFiles(project) });
    }
    if (req.method === "GET" && parts[3] === "exports" && parts[4] === "preview") {
      return sendJson(res, 200, await previewExportFile(project, url.searchParams.get("path")));
    }
    if (req.method === "GET" && parts[3] === "exports" && parts[4] === "download") {
      const file = await downloadExportFile(project, url.searchParams.get("path"));
      const encoded = encodeURIComponent(file.name).replaceAll("'", "%27");
      return sendBuffer(res, 200, file.buffer, { "Content-Type": file.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encoded}` });
    }
    if (req.method === "DELETE" && parts[3] === "exports" && parts.length === 4) {
      const relativePath = url.searchParams.get("path");
      const trashPath = await deleteExportFile(project, relativePath);
      await appendVersionEvent(project, { type: "export.deleted", relativePath, trashPath, createdAt: new Date().toISOString() });
      return sendJson(res, 200, { deleted: true, trashPath });
    }
    if (req.method === "POST" && parts[3] === "exports" && parts.length === 4) {
      const body = await jsonBody(req);
      const sources = store.listSources(project.id);
      const runs = store.listRuns(project.id);
      const versions = store.listStageVersions(project.id);
      const options = { mode: body.mode === "draft" ? "draft" : "formal", runId: body.runId || null };
      const target = body.format === "docx"
        ? await exportDocx(project, sources, versions, runs, body.language || "zh", options)
        : body.format === "bibtex"
          ? await exportBibtex(project, sources)
          : body.format === "latex"
            ? await exportLatex(project, versions)
            : body.format === "package"
              ? await exportDeliveryPackage(project, sources, versions)
            : await exportMarkdown(project, sources, versions, runs, body.language || "zh", options);
      await appendVersionEvent(project, { type: "export.created", mode: options.mode, format: body.format, language: body.language || "zh", path: target, createdAt: new Date().toISOString(), versionIds: versions.filter((version) => version.status === "active").map((version) => version.id) });
      return sendJson(res, 201, { path: target });
    }
  }
  if (req.method === "GET" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts[3] === "events") {
    const runId = parts[2];
    const run = store.getRun(runId);
    if (!run) return sendJson(res, 404, { error: "运行记录不存在" });
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "run", run });
    const listener = (event) => send(event);
    codex.on(`run:${runId}`, listener);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);
    req.on("close", () => { clearInterval(heartbeat); codex.off(`run:${runId}`, listener); });
    return;
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "approvals" && parts[2]) {
    const body = await jsonBody(req);
    if (!["accept", "decline", "cancel"].includes(body.decision)) throw new Error("无效审批决定");
    await codex.resolveApproval(parts[2], body.decision);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "evidence" && parts[2] && parts[3] === "review") {
    const body = await jsonBody(req);
    if (!["verified", "rejected", "conflicted", "pending"].includes(body.status)) throw new Error("无效的证据核验状态");
    const claim = store.updateEvidenceClaim(parts[2], { verificationStatus: body.status, note: body.note || null, verifiedAt: body.status === "pending" ? null : new Date().toISOString() });
    if (!claim) return sendJson(res, 404, { error: "证据卡不存在" });
    return sendJson(res, 200, { claim });
  }
  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "evidence" && parts[2] && parts.length === 3) {
    const claim = store.getEvidenceClaim(parts[2]);
    if (!claim) return sendJson(res, 404, { error: "证据卡不存在" });
    const project = requireProject(claim.projectId);
    store.deleteEvidenceClaim(claim.id);
    const target = path.join(project.projectPath, "02-sources", "evidence-cards", "evidence.jsonl");
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify({ type: "evidence.deleted", evidenceId: claim.id, deletedAt: new Date().toISOString() })}\n`, "utf8");
    return sendJson(res, 200, { deleted: true });
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts[3] === "reviews") {
    const body = await jsonBody(req);
    if (!["adopt", "reject", "request_revision"].includes(body.decision)) throw new Error("无效的内容审阅决定");
    return sendJson(res, body.decision === "request_revision" ? 202 : 200, await reviewCompletedRun(store.getRun(parts[2]), body.decision, body.note || ""));
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts[3] === "retry") {
    const sourceRun = store.getRun(parts[2]);
    if (!sourceRun) throw new Error("运行记录不存在");
    if (!['failed', 'cancelled', 'declined', 'completed'].includes(sourceRun.status)) throw new Error("当前运行尚未结束，不能重试");
    const project = requireProject(sourceRun.projectId);
    const run = await startLinkedRun(project, sourceRun, buildRetryPrompt(sourceRun.prompt), `重新运行：${sourceRun.prompt}`);
    return sendJson(res, 202, { run });
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts[3] === "cancel") {
    return sendJson(res, 200, await codex.cancelRun(parts[2]));
  }
  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts.length === 3) {
    const run = store.getRun(parts[2]);
    if (!run) return sendJson(res, 404, { error: "运行记录不存在" });
    const project = requireProject(run.projectId);
    const deleted = store.deleteRun(run.id);
    const trashPath = await moveToProjectTrash(project, run.artifactPath, "runs");
    await appendRunEvent(project, { type: "run.deleted", runId: run.id, skillName: run.skillName, status: run.status, trashPath, createdAt: new Date().toISOString() });
    return sendJson(res, 200, { deleted: Boolean(deleted), trashPath });
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[2] && parts[3] === "adopt") {
    return sendJson(res, 200, await reviewCompletedRun(store.getRun(parts[2]), "adopt", ""));
  }
  return sendJson(res, 404, { error: "接口不存在" });
}

async function serveStatic(res, pathname) {
  let relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  let target = path.resolve(DIST_DIR, `.${relative}`);
  if (!target.startsWith(path.resolve(DIST_DIR))) return sendJson(res, 403, { error: "路径被拒绝" });
  try { await access(target); }
  catch { target = path.join(DIST_DIR, "index.html"); }
  const body = await readFile(target);
  res.writeHead(200, { "Content-Type": contentTypes[path.extname(target)] || "application/octet-stream", "Cache-Control": path.extname(target) === ".html" ? "no-cache" : "public, max-age=31536000, immutable", "X-AI-Research-Workbench": VERSION });
  res.end(body);
}

await mkdir(path.join(APP_ROOT, "data"), { recursive: true });
await initializeVault(DEFAULT_VAULT_ROOT);
for (const interrupted of store.recoverInterruptedRuns()) {
  const project = store.getProject(interrupted.projectId);
  if (!project) continue;
  const artifactPath = await saveRunDraft(project, interrupted);
  const saved = store.updateRun(interrupted.id, { artifactPath });
  await appendRunEvent(project, { type: `run.${saved.status}`, run: saved, recoveredAt: new Date().toISOString() });
}
if (process.env.AI_RESEARCH_SKIP_CODEX_START !== "1") codex.start().catch(() => {});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith("/api/")) await routeApi(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    if (!res.headersSent) sendJson(res, error.status || 400, { error: error.message || String(error) });
    else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`AI科研工作台已启动：http://${HOST}:${PORT}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { codex.stop(); server.close(() => process.exit(0)); });
