import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { translateExport } from "./export-translation.mjs";
import { createClient } from "@supabase/supabase-js";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { abortActiveRun, callModel, listAvailableModels } from "./model-gateway.mjs";
import { normalizeCloudProviderInput } from "./provider-config.mjs";
import { encryptSecret, keyHint } from "./crypto.mjs";
import { publicOcrConfig } from "./ocr-config.mjs";
import { buildVerifiedBibtex } from "./bibtex.mjs";
import {
  adminClient, assertAdmin, authenticate, deleteRow, insertRow, listRows, mapEvidence, mapProject, mapRun, mapSource,
  mapVersion, mappedProjectDetail, oneRow, ownerCounts, updateRow,
} from "./repository.mjs";
import { appendConversationTurn, CLOUD_SKILLS, currentRunMessage, getSkill } from "./skills.mjs";
import { sha256 } from "./source-processing.mjs";
import { assertPublicHttpsUrl, safeFileName, slugify } from "./security.mjs";
import { contentHash, dispatchRun, dispatchSource, enforceRateLimit, executeRun, executeSource, releaseGlobalRunSlot, reserveGlobalRunSlot, verifyQStash } from "./runner.mjs";
import { validateEvidenceInput, validateEvidenceReview, validateReviewDecision } from "./validation.mjs";
import { normalizeTrialAccount, trialLoginEmail, validateTrialPassword } from "./auth-trial.mjs";
import { createSourceUploadTarget, expectedSourceUploadPath, MAX_SOURCE_FILE_BYTES, validateSourceUpload } from "./source-upload.mjs";
import { clearCloudResearchData } from "./data-management.mjs";
import { advanceProjectStage, downstreamStages, stageForSkill } from "../server/research-state.mjs";

const storage = () => adminClient().storage.from("research-files");

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function binary(res, value, mime, filename) {
  res.statusCode = 200;
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.end(value);
}

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function bodyJson(req, raw = null) {
  if (req.body && !Buffer.isBuffer(req.body) && typeof req.body === "object") return req.body;
  const buffer = raw || await rawBody(req);
  if (!buffer.length) return {};
  try { return JSON.parse(buffer.toString("utf8")); } catch { throw Object.assign(new Error("请求正文不是有效 JSON"), { statusCode: 400 }); }
}

function routePath(req) {
  const url = new URL(req.url, "https://local.invalid");
  const captured = req.query?.path ?? url.searchParams.get("path");
  const value = Array.isArray(captured) ? captured.join("/") : captured;
  return `/${String(value || "").replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function ensureString(value, label, max = 20000) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(`${label}不能为空`), { statusCode: 400 });
  if (text.length > max) throw Object.assign(new Error(`${label}超过长度上限`), { statusCode: 400 });
  return text;
}

const trialRegistrationBuckets = new Map();

function enforceTrialRegistrationRateLimit(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const key = forwarded || req.socket?.remoteAddress || "local";
  const now = Date.now();
  const recent = (trialRegistrationBuckets.get(key) || []).filter((stamp) => now - stamp < 10 * 60 * 1000);
  if (recent.length >= 10) throw Object.assign(new Error("注册尝试过于频繁，请稍后再试"), { statusCode: 429 });
  recent.push(now);
  trialRegistrationBuckets.set(key, recent);
}

async function auditAdmin(adminId, action, targetUserId = null, resourceType = null, resourceId = null, details = {}) {
  const result = await adminClient().from("admin_audit_logs").insert({ admin_id: adminId, target_user_id: targetUserId, action, resource_type: resourceType, resource_id: resourceId, details });
  if (result.error) throw new Error(result.error.message);
}

async function assertProject(ownerId, projectId) { return oneRow("projects", ownerId, projectId); }
async function assertRunProject(ownerId, run) { return assertProject(ownerId, run.project_id); }
function assertBelongs(row, projectId, label = "记录") {
  if (row.project_id !== projectId) throw Object.assign(new Error(`${label}不属于当前课题`), { statusCode: 403 });
  return row;
}

async function storageUpload(path, value, contentType) {
  const result = await storage().upload(path, value, { contentType, upsert: true });
  if (result.error) throw new Error(result.error.message);
  return path;
}

async function storageDownload(path) {
  const result = await storage().download(path);
  if (result.error) throw new Error(result.error.message);
  return Buffer.from(await result.data.arrayBuffer());
}

async function projectsList(ownerId) {
  const projectColumns = "id,owner_id,name,slug,field,goal,language,paper_type,status,stage,created_at,updated_at";
  const rows = await listRows("projects", ownerId, {}, { column: "updated_at" }, projectColumns);
  const [sources, runs] = await Promise.all([
    listRows("sources", ownerId, {}, null, "id,project_id"),
    listRows("runs", ownerId, {}, { column: "started_at" }, "id,project_id,status,started_at"),
  ]);
  const sourceCounts = new Map();
  const runCounts = new Map();
  for (const item of sources) sourceCounts.set(item.project_id, (sourceCounts.get(item.project_id) || 0) + 1);
  for (const item of runs) {
    const current = runCounts.get(item.project_id) || { count: 0, latest: null };
    current.count += 1;
    if (!current.latest) current.latest = item.status;
    runCounts.set(item.project_id, current);
  }
  return rows.map((row) => {
    const projectRuns = runCounts.get(row.id);
    return mapProject(row, { sourceCount: sourceCounts.get(row.id) || 0, runCount: projectRuns?.count || 0, latestRunStatus: projectRuns?.latest || null });
  });
}

async function createRun(ownerId, projectId, skillName, input, parentRunId = null) {
  const project = await assertProject(ownerId, projectId);
  getSkill(skillName);
  const maxActiveRuns = Math.min(5, Math.max(1, Number(process.env.MAX_ACTIVE_RUNS_PER_USER || 2)));
  const [active, ownerActive] = await Promise.all([
    adminClient().from("runs").select("id").eq("owner_id", ownerId).eq("project_id", projectId).in("status", ["queued", "running"]).limit(1),
    adminClient().from("runs").select("id").eq("owner_id", ownerId).in("status", ["queued", "running"]).limit(maxActiveRuns),
  ]);
  if (active.error) throw new Error(active.error.message);
  if (ownerActive.error) throw new Error(ownerActive.error.message);
  if (active.data.length) throw Object.assign(new Error("当前课题已有运行中的任务，请完成或取消后再试"), { statusCode: 409 });
  if (ownerActive.data.length >= maxActiveRuns) throw Object.assign(new Error(`当前账号最多同时运行 ${maxActiveRuns} 个任务，请等待或取消已有任务`), { statusCode: 429 });
  const prompt = currentRunMessage(skillName, input);
  const run = await insertRow("runs", ownerId, { project_id: project.id, skill_name: skillName, status: "queued", prompt, input_json: JSON.stringify(input || {}), parent_run_id: parentRunId });
  try {
    await reserveGlobalRunSlot(run.id);
    await dispatchRun(ownerId, run.id);
  } catch (error) {
    await releaseGlobalRunSlot(run.id).catch(() => {});
    await updateRow("runs", ownerId, run.id, { status: "failed", error: error.message, completed_at: new Date().toISOString() });
    throw error;
  }
  return mapRun(run);
}

async function adoptRun(ownerId, run, note) {
  if (run.status !== "completed") throw Object.assign(new Error("只有已完成的结果可以采用"), { statusCode: 409 });
  const stage = stageForSkill(run.skill_name);
  if (!stage) throw new Error("当前 Skill 尚未接入正式版本状态机");
  const current = await listRows("stage_versions", ownerId, { project_id: run.project_id, stage });
  const stamp = new Date().toISOString();
  for (const item of current.filter((item) => item.status === "active")) await updateRow("stage_versions", ownerId, item.id, { status: "superseded", superseded_at: stamp });
  const version = await insertRow("stage_versions", ownerId, {
    project_id: run.project_id, stage, version_number: Math.max(0, ...current.map((item) => item.version_number)) + 1,
    run_id: run.id, skill_name: run.skill_name, content: run.output, content_sha256: contentHash(run.output), status: "active", adopted_at: stamp,
  });
  const affected = downstreamStages(stage);
  if (affected.length) {
    const downstream = await listRows("stage_versions", ownerId, { project_id: run.project_id });
    for (const item of downstream.filter((item) => affected.includes(item.stage) && item.status === "active")) await updateRow("stage_versions", ownerId, item.id, { status: "needs_review" });
  }
  const project = await oneRow("projects", ownerId, run.project_id);
  const nextStage = advanceProjectStage(project.stage, stage);
  const updatedProject = await updateRow("projects", ownerId, project.id, { stage: nextStage, updated_at: stamp });
  const updatedRun = await updateRow("runs", ownerId, run.id, { review_status: "adopted", review_note: note || null, reviewed_at: stamp, adopted_at: stamp });
  return { run: mapRun(updatedRun), version: mapVersion(version), project: mapProject(updatedProject) };
}

function exportText(project, versions, language) {
  const heading = language === "en" ? `# ${project.name}\n\nResearch goal: ${project.goal}` : `# ${project.name}\n\n研究目标：${project.goal}`;
  const sections = versions.filter((item) => item.status === "active").sort((a, b) => a.adopted_at.localeCompare(b.adopted_at))
    .map((item) => `\n\n## ${item.stage} · v${item.version_number}\n\n${item.content}`);
  return `${heading}${sections.join("")}\n\n---\n由作者人工采用的阶段版本汇编；引用、实验、署名与投稿决定仍由作者最终确认。\n`;
}

async function buildExportBuffer(project, versions, format, language, sources = [], translated = null) {
  const markdown = translated ?? exportText(project, versions, language);
  if (format === "markdown" || format === "latex" || format === "bibtex") {
    if (format === "latex") return { buffer: Buffer.from(`\\documentclass{article}\n\\usepackage[UTF8]{ctex}\n\\begin{document}\n${markdown.replace(/[\\%&#_$]/g, "\\$&")}\n\\end{document}\n`), ext: "tex", mime: "application/x-tex", preview: markdown };
    if (format === "bibtex") {
      const bibtex = buildVerifiedBibtex(sources);
      return { buffer: Buffer.from(bibtex), ext: "bib", mime: "application/x-bibtex", preview: bibtex };
    }
    return { buffer: Buffer.from(markdown), ext: "md", mime: "text/markdown", preview: markdown };
  }
  if (format === "docx") {
    const children = markdown.split(/\n{2,}/).filter(Boolean).map((block) => block.startsWith("# ")
      ? new Paragraph({ text: block.slice(2), heading: HeadingLevel.TITLE })
      : block.startsWith("## ") ? new Paragraph({ text: block.slice(3), heading: HeadingLevel.HEADING_1 }) : new Paragraph(block));
    return { buffer: Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] }))), ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview: markdown };
  }
  const word = await buildExportBuffer(project, versions, "docx", language, sources, markdown);
  const baseName = language === "en" ? "Research-Plan-English" : safeFileName(project.name);
  const zip = new JSZip();
  zip.file(`${baseName}.md`, markdown);
  zip.file(`${baseName}.docx`, word.buffer);
  zip.file("README.txt", language === "en"
    ? "Contents: Markdown research manuscript, Word research manuscript (same content), and this responsibility notice. Only author-adopted stage versions are included. AI translations require human review. Verify citations, experiments, authorship, ethics and formatting before submission.\n"
    : "文件清单：Markdown 研究稿（.md）、Word 研究稿（.docx）及本责任边界说明。两份研究稿内容一致，只包含已由作者采用的阶段版本。请在正式投稿前复核引用、实验、署名、伦理与格式。\n");
  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), ext: "zip", mime: "application/zip", preview: language === "en" ? "Package includes Markdown and Word research manuscripts, plus a responsibility notice." : "交付包包含 Markdown 研究稿、Word 研究稿与责任边界说明。" };
}

function mapExport(row) {
  return { name: row.name, relativePath: row.id, format: row.format, language: row.language, size: row.size, modifiedAt: row.created_at, previewKind: row.format === "docx" ? "docx-text" : row.format === "package" ? "package-manifest" : row.format === "markdown" ? "markdown" : "plain-text", releaseStatus: row.release_status };
}

export async function handleCloudRequest(req, res) {
  const path = routePath(req);
  const method = String(req.method || "GET").toUpperCase();
  let raw = null;
  try {
    if (path === "/jobs/execute" && method === "POST") {
      raw = await rawBody(req); await verifyQStash(req, raw); const payload = await bodyJson(req, raw);
      await executeRun(ensureString(payload.ownerId, "ownerId"), ensureString(payload.runId, "runId")); return json(res, 200, { ok: true });
    }
    if (path === "/jobs/source-process" && method === "POST") {
      raw = await rawBody(req); await verifyQStash(req, raw); const payload = await bodyJson(req);
      await executeSource(ensureString(payload.ownerId, "ownerId"), ensureString(payload.projectId, "projectId"), ensureString(payload.sourceId, "sourceId"));
      return json(res, 200, { ok: true });
    }

    if (path === "/auth/register" && method === "POST") {
      enforceTrialRegistrationRateLimit(req);
      const input = await bodyJson(req);
      const account = normalizeTrialAccount(input.account);
      const password = validateTrialPassword(input.password);
      const loginEmail = trialLoginEmail(account);
      const created = await adminClient().auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true,
        user_metadata: { username: account, display_name: account },
        app_metadata: { role: "user" },
      });
      if (created.error || !created.data.user) {
        const detail = created.error?.message || "账号创建失败";
        if (/already|registered|exists/i.test(detail)) throw Object.assign(new Error("该手机号或邮箱已注册，请直接登录"), { statusCode: 409 });
        throw new Error(detail);
      }
      const profile = await adminClient().from("profiles").upsert({
        id: created.data.user.id,
        username: account,
        display_name: account,
        role: "user",
        status: "active",
        force_logout_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (profile.error) throw new Error(profile.error.message);
      return json(res, 201, { ok: true });
    }

    const user = await authenticate(req);
    await enforceRateLimit(user.id, method === "GET" ? 120 : 30);

    if (path === "/session" && method === "GET") {
      return json(res, 200, { user: { id: user.id, username: user.profile.username || user.user_metadata?.username || "researcher", role: user.profile.role, status: user.profile.status } });
    }

    if (path === "/account/password" && method === "POST") {
      const input = await bodyJson(req);
      const currentPassword = ensureString(input.currentPassword, "当前密码", 200);
      const newPassword = validateTrialPassword(input.newPassword);
      if (currentPassword === newPassword) throw Object.assign(new Error("新密码不能与当前密码相同"), { statusCode: 400 });
      const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!process.env.SUPABASE_URL || !anonKey) throw new Error("在线服务配置不完整");
      const verifier = createClient(process.env.SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const verified = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (verified.error) throw Object.assign(new Error("当前密码不正确"), { statusCode: 400 });
      await verifier.auth.signOut();
      const changed = await adminClient().auth.admin.updateUserById(user.id, { password: newPassword });
      if (changed.error) throw new Error(changed.error.message);
      const stamp = new Date().toISOString();
      const profile = await adminClient().from("profiles").update({ force_logout_at: stamp, updated_at: stamp }).eq("id", user.id);
      if (profile.error) throw new Error(profile.error.message);
      return json(res, 200, { ok: true });
    }

    if (path === "/account/research-data" && method === "DELETE") {
      const result = await clearCloudResearchData(user.id);
      return json(res, 200, result);
    }

    let adminMatch;
    if (path === "/admin/users" && method === "GET") {
      assertAdmin(user);
      const [authResult, profilesResult, projectsResult, sourcesResult] = await Promise.all([
        adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }),
        adminClient().from("profiles").select("*"),
        adminClient().from("projects").select("id,owner_id"),
        adminClient().from("sources").select("id,owner_id"),
      ]);
      if (authResult.error || profilesResult.error || projectsResult.error || sourcesResult.error) throw new Error(authResult.error?.message || profilesResult.error?.message || projectsResult.error?.message || sourcesResult.error?.message);
      const profiles = new Map((profilesResult.data || []).map((item) => [item.id, item]));
      const items = (authResult.data.users || []).map((account) => {
        const profile = profiles.get(account.id) || {};
        return { id: account.id, username: profile.username || account.user_metadata?.username || "未命名用户", role: profile.role || account.app_metadata?.role || "user", status: profile.status || "active", createdAt: account.created_at, lastSignInAt: account.last_sign_in_at, projectCount: (projectsResult.data || []).filter((item) => item.owner_id === account.id).length, sourceCount: (sourcesResult.data || []).filter((item) => item.owner_id === account.id).length };
      });
      return json(res, 200, { items });
    }

    if (path === "/admin/feedback" && method === "GET") {
      assertAdmin(user);
      const [feedbackResult, profilesResult] = await Promise.all([
        adminClient().from("product_feedback").select("*").order("created_at", { ascending: false }).limit(200),
        adminClient().from("profiles").select("id,username"),
      ]);
      if (feedbackResult.error || profilesResult.error) throw new Error(feedbackResult.error?.message || profilesResult.error?.message);
      const names = new Map((profilesResult.data || []).map((item) => [item.id, item.username]));
      return json(res, 200, { items: (feedbackResult.data || []).map((item) => ({ id: item.id, ownerId: item.owner_id, username: names.get(item.owner_id) || "未知用户", category: item.category, title: item.title, details: item.details, reproduction: item.reproduction, expected: item.expected, contact: item.contact, status: item.status, createdAt: item.created_at })) });
    }

    adminMatch = path.match(/^\/admin\/feedback\/([^/]+)\/status$/);
    if (adminMatch && method === "POST") {
      assertAdmin(user);
      const input = await bodyJson(req); const status = input.status;
      if (!["submitted", "reviewing", "resolved", "closed"].includes(status)) throw Object.assign(new Error("无效的反馈状态"), { statusCode: 400 });
      const current = await adminClient().from("product_feedback").select("*").eq("id", adminMatch[1]).maybeSingle();
      if (current.error || !current.data) throw Object.assign(new Error("反馈不存在"), { statusCode: 404 });
      const updated = await adminClient().from("product_feedback").update({ status }).eq("id", adminMatch[1]);
      if (updated.error) throw new Error(updated.error.message);
      await auditAdmin(user.id, "update_feedback_status", current.data.owner_id, "feedback", current.data.id, { status });
      return json(res, 200, { ok: true });
    }

    if (path === "/admin/files" && method === "GET") {
      assertAdmin(user);
      const url = new URL(req.url, "https://local.invalid");
      const ownerId = ensureString(url.searchParams.get("ownerId"), "用户ID", 100);
      const [projectsResult, sourcesResult, exportsResult] = await Promise.all([
        adminClient().from("projects").select("id,name,owner_id").eq("owner_id", ownerId),
        adminClient().from("sources").select("id,project_id,name,size,mime_type,blob_url,url,created_at,owner_id").eq("owner_id", ownerId).order("created_at", { ascending: false }),
        adminClient().from("exports").select("id,project_id,name,size,format,blob_url,created_at,owner_id").eq("owner_id", ownerId).order("created_at", { ascending: false }),
      ]);
      if (projectsResult.error || sourcesResult.error || exportsResult.error) throw new Error(projectsResult.error?.message || sourcesResult.error?.message || exportsResult.error?.message);
      const projectNames = new Map((projectsResult.data || []).map((item) => [item.id, item.name]));
      return json(res, 200, { projects: projectsResult.data || [], items: [
        ...(sourcesResult.data || []).map((item) => ({ id: item.id, kind: "source", name: item.name, projectId: item.project_id, projectName: projectNames.get(item.project_id), size: item.size || 0, format: item.mime_type || "source", downloadable: Boolean(item.blob_url), externalUrl: item.url || null, createdAt: item.created_at })),
        ...(exportsResult.data || []).map((item) => ({ id: item.id, kind: "export", name: item.name, projectId: item.project_id, projectName: projectNames.get(item.project_id), size: item.size || 0, format: item.format, downloadable: Boolean(item.blob_url), externalUrl: null, createdAt: item.created_at })),
      ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    }

    adminMatch = path.match(/^\/admin\/users\/([^/]+)\/(status|signout|password)$/);
    if (adminMatch && method === "POST") {
      assertAdmin(user);
      const targetId = adminMatch[1];
      if (targetId === user.id) throw Object.assign(new Error("不能对当前管理员账号执行此操作"), { statusCode: 409 });
      const targetResult = await adminClient().from("profiles").select("*").eq("id", targetId).maybeSingle();
      if (targetResult.error || !targetResult.data) throw Object.assign(new Error("用户不存在"), { statusCode: 404 });
      if (targetResult.data.role === "admin") throw Object.assign(new Error("不能管理其他管理员账号"), { statusCode: 403 });
      if (adminMatch[2] === "password") {
        const input = await bodyJson(req);
        const password = validateTrialPassword(input.password);
        const authUpdate = await adminClient().auth.admin.updateUserById(targetId, { password });
        if (authUpdate.error) throw new Error(authUpdate.error.message);
        const stamp = new Date().toISOString();
        const profileUpdate = await adminClient().from("profiles").update({ force_logout_at: stamp, updated_at: stamp }).eq("id", targetId);
        if (profileUpdate.error) throw new Error(profileUpdate.error.message);
        await auditAdmin(user.id, "reset_user_password", targetId, "user", targetId);
        return json(res, 200, { ok: true });
      }
      if (adminMatch[2] === "signout") {
        const stamp = new Date().toISOString();
        const result = await adminClient().from("profiles").update({ force_logout_at: stamp, updated_at: stamp }).eq("id", targetId);
        if (result.error) throw new Error(result.error.message);
        await auditAdmin(user.id, "force_signout", targetId, "user", targetId);
        return json(res, 200, { ok: true });
      }
      const input = await bodyJson(req); const status = input.status;
      if (!["active", "disabled"].includes(status)) throw Object.assign(new Error("无效的账号状态"), { statusCode: 400 });
      const stamp = new Date().toISOString();
      const updateResult = await adminClient().from("profiles").update({ status, force_logout_at: status === "disabled" ? stamp : null, updated_at: stamp }).eq("id", targetId);
      if (updateResult.error) throw new Error(updateResult.error.message);
      const authUpdate = await adminClient().auth.admin.updateUserById(targetId, { ban_duration: status === "disabled" ? "876000h" : "none" });
      if (authUpdate.error) throw new Error(authUpdate.error.message);
      await auditAdmin(user.id, status === "disabled" ? "disable_user" : "enable_user", targetId, "user", targetId);
      return json(res, 200, { ok: true });
    }

    adminMatch = path.match(/^\/admin\/files\/(source|export)\/([^/]+)\/download$/);
    if (adminMatch && method === "GET") {
      assertAdmin(user);
      const table = adminMatch[1] === "source" ? "sources" : "exports";
      const result = await adminClient().from(table).select("*").eq("id", adminMatch[2]).maybeSingle();
      if (result.error || !result.data) throw Object.assign(new Error("文件不存在"), { statusCode: 404 });
      if (!result.data.blob_url) throw Object.assign(new Error("该记录没有可下载的文件副本"), { statusCode: 404 });
      const value = await storageDownload(result.data.blob_url);
      await auditAdmin(user.id, "download_user_file", result.data.owner_id, adminMatch[1], result.data.id, { name: result.data.name });
      return binary(res, value, result.data.mime_type || "application/octet-stream", result.data.name || `${result.data.id}.bin`);
    }

    if (path === "/health" && method === "GET") {
      const counts = await ownerCounts(user.id);
      const providers = await listRows("model_configs", user.id);
      const activeProvider = providers.find((item) => item.is_default) || null;
      const canViewSkillsCatalog = user.app_metadata?.role === "admin" && user.profile?.role === "admin";
      return json(res, 200, {
        app: { status: "ready", version: "0.4.1", port: 443 },
        codex: { status: activeProvider ? "ready" : "unavailable", cliVersion: activeProvider?.model || null, authenticated: Boolean(activeProvider), accountType: "Personal API", transport: "online-model-service", error: activeProvider ? null : "请配置并启用模型 API" },
        skills: { expected: CLOUD_SKILLS.length, ready: CLOUD_SKILLS.length, totalDiscovered: CLOUD_SKILLS.length, items: canViewSkillsCatalog ? CLOUD_SKILLS : [], warning: null },
        vault: { root: "用户专属资料空间", exists: true, writable: true }, deepLink: { registered: false, template: "workspace://project/{id}" },
        database: { integrity: "ok", ...counts },
      });
    }

    if (path === "/cloud/providers" && method === "GET") {
      const items = await listRows("model_configs", user.id, {}, { column: "updated_at" });
      return json(res, 200, { items: items.filter((item) => item.provider !== "paddleocr").map((item) => ({ id: item.id, provider: item.provider, model: item.model, baseUrl: item.base_url, keyHint: item.key_hint, isDefault: item.is_default })) });
    }
    if (path === "/cloud/ocr" && method === "GET") {
      const items = await listRows("model_configs", user.id, { provider: "paddleocr", model: "pp-structure-v3" }, { column: "updated_at" });
      return json(res, 200, publicOcrConfig(items[0] || null));
    }
    if (path === "/cloud/ocr" && method === "PUT") {
      const input = await bodyJson(req);
      const accessToken = ensureString(input.accessToken, "PaddleOCR Access Token", 2000);
      if (accessToken.length < 16) throw Object.assign(new Error("PaddleOCR Access Token 格式不正确"), { statusCode: 400 });
      const encryptedApiKey = encryptSecret(accessToken);
      const existing = await listRows("model_configs", user.id, { provider: "paddleocr", model: "pp-structure-v3" }, { column: "updated_at" });
      const values = {
        provider: "paddleocr",
        model: "pp-structure-v3",
        base_url: "https://paddleocr.aistudio-app.com",
        encrypted_api_key: encryptedApiKey,
        key_hint: keyHint(accessToken),
        is_default: false,
        updated_at: new Date().toISOString(),
      };
      const saved = existing[0]
        ? await updateRow("model_configs", user.id, existing[0].id, values)
        : await insertRow("model_configs", user.id, values);
      return json(res, 200, { ok: true, config: publicOcrConfig(saved) });
    }
    if (path === "/cloud/ocr" && method === "DELETE") {
      const existing = await listRows("model_configs", user.id, { provider: "paddleocr", model: "pp-structure-v3" }, { column: "updated_at" });
      if (existing[0]) await deleteRow("model_configs", user.id, existing[0].id);
      return json(res, 200, { deleted: Boolean(existing[0]) });
    }
    if (path === "/cloud/providers" && method === "PUT") {
      const input = await bodyJson(req);
      const requestedProvider = ensureString(input.provider, "模型平台", 40);
      const requestedModel = ensureString(input.model, "模型名称", 120);
      const requestedBaseUrl = ensureString(input.baseUrl, "接口地址", 500);
      const apiKey = ensureString(input.apiKey, "API Key", 1000);
      const normalized = normalizeCloudProviderInput({ provider: requestedProvider, model: requestedModel, baseUrl: requestedBaseUrl });
      const { provider, model, baseUrl } = normalized;
      await assertPublicHttpsUrl(baseUrl, "模型接口地址");
      const encryptedApiKey = encryptSecret(apiKey);
      await callModel(
        { provider, base_url: baseUrl, model, encrypted_api_key: encryptedApiKey },
        [{ role: "user", content: "这是模型连接测试。请只回复 OK。" }],
        `provider-test-${user.id}-${Date.now()}`,
        {
          timeoutMs: provider === "zhipu" ? 120_000 : 45_000,
          maxTokens: 128,
          ...(provider === "deepseek" ? { thinking: "disabled" } : {}),
          ...(["kimi", "kimi_global"].includes(provider) ? { thinking: "disabled" } : {}),
          ...(provider === "zhipu" && /^glm-5\.3(?:[-_.]|$)/i.test(model) ? { thinking: "enabled", reasoningEffort: "low" } : {}),
        },
      );
      const existing = await listRows("model_configs", user.id);
      for (const item of existing.filter((item) => item.is_default)) await updateRow("model_configs", user.id, item.id, { is_default: false, updated_at: new Date().toISOString() });
      const same = existing.find((item) => item.provider === provider && item.model === model);
      const values = { provider, model, base_url: baseUrl, encrypted_api_key: encryptedApiKey, key_hint: keyHint(apiKey), is_default: true, updated_at: new Date().toISOString() };
      if (same) await updateRow("model_configs", user.id, same.id, values); else await insertRow("model_configs", user.id, values);
      return json(res, 200, { ok: true, tested: true, normalized: normalized.corrected, provider, model, baseUrl });
    }

    if (path === "/cloud/providers/models" && method === "POST") {
      await enforceRateLimit(user.id, 30);
      const input = await bodyJson(req);
      const baseUrl = ensureString(input.baseUrl, "接口地址", 500);
      const apiKey = ensureString(input.apiKey, "API Key", 1000);
      const models = await listAvailableModels(baseUrl, apiKey, 15_000, input.provider);
      if (!models.length) throw Object.assign(new Error("接口没有返回可选择的模型，请使用手动填写"), { statusCode: 422 });
      return json(res, 200, { models });
    }

    let providerMatch = path.match(/^\/cloud\/providers\/([^/]+)\/activate$/);
    if (providerMatch && method === "POST") {
      const target = await oneRow("model_configs", user.id, providerMatch[1]);
      await callModel(
        target,
        [{ role: "user", content: "这是模型切换测试。请只回复 OK。" }],
        `provider-activate-${user.id}-${Date.now()}`,
        {
          timeoutMs: target.provider === "zhipu" ? 120_000 : 45_000,
          maxTokens: 128,
          ...(["deepseek", "kimi", "kimi_global"].includes(target.provider) ? { thinking: "disabled" } : {}),
          ...(target.provider === "zhipu" && /^glm-5\.3(?:[-_.]|$)/i.test(target.model) ? { thinking: "enabled", reasoningEffort: "low" } : {}),
        },
      );
      const existing = await listRows("model_configs", user.id);
      for (const item of existing.filter((item) => item.is_default && item.id !== target.id)) {
        await updateRow("model_configs", user.id, item.id, { is_default: false, updated_at: new Date().toISOString() });
      }
      await updateRow("model_configs", user.id, target.id, { is_default: true, updated_at: new Date().toISOString() });
      return json(res, 200, { ok: true, tested: true, activeId: target.id });
    }

    providerMatch = path.match(/^\/cloud\/providers\/([^/]+)$/);
    if (providerMatch && method === "DELETE") {
      const target = await oneRow("model_configs", user.id, providerMatch[1]);
      if (target.is_default) throw Object.assign(new Error("当前生效模型不能直接删除，请先切换到其他模型"), { statusCode: 409 });
      await deleteRow("model_configs", user.id, target.id);
      return json(res, 200, { deleted: true });
    }

    if (path === "/feedback" && method === "GET") {
      const rows = await listRows("product_feedback", user.id, {}, { column: "created_at" });
      return json(res, 200, { items: rows.slice(0, 20).map((item) => ({ id: item.id, projectId: item.project_id, category: item.category, title: item.title, details: item.details, reproduction: item.reproduction, expected: item.expected, contact: item.contact, context: item.context || {}, status: item.status, createdAt: item.created_at })) });
    }
    if (path === "/feedback" && method === "POST") {
      const input = await bodyJson(req);
      const category = ensureString(input.category, "反馈类型", 20);
      if (!["bug", "feature", "question", "other"].includes(category)) throw Object.assign(new Error("无效的反馈类型"), { statusCode: 400 });
      if (input.projectId) await assertProject(user.id, input.projectId);
      const item = await insertRow("product_feedback", user.id, {
        project_id: input.projectId || null, category,
        title: ensureString(input.title, "反馈标题", 120), details: ensureString(input.details, "详细说明", 5000),
        reproduction: String(input.reproduction || "").trim() || null, expected: String(input.expected || "").trim() || null,
        contact: String(input.contact || "").trim() || null, context: input.context || {}, status: "submitted",
      });
      return json(res, 201, { item: { id: item.id, projectId: item.project_id, category: item.category, title: item.title, details: item.details, reproduction: item.reproduction, expected: item.expected, contact: item.contact, context: item.context || {}, status: item.status, createdAt: item.created_at } });
    }

    if (path === "/projects" && method === "GET") return json(res, 200, { projects: await projectsList(user.id) });
    if (path === "/projects" && method === "POST") {
      const input = await bodyJson(req); const name = ensureString(input.name, "课题名称", 200); const now = new Date().toISOString();
      const project = await insertRow("projects", user.id, { name, slug: slugify(name), field: ensureString(input.field, "学科或领域", 200), goal: ensureString(input.goal, "研究目标", 5000), language: input.language || "zh", paper_type: input.paperType || "general", status: "active", stage: "brief", created_at: now, updated_at: now });
      return json(res, 201, { project: mapProject(project), codexWarning: "云端模式使用用户配置的模型 API，不创建 Codex Desktop 任务。" });
    }

    let match = path.match(/^\/projects\/([^/]+)$/);
    if (match && method === "GET") return json(res, 200, await mappedProjectDetail(user.id, match[1]));
    if (match && method === "PATCH") {
      await assertProject(user.id, match[1]); const input = await bodyJson(req);
      const project = await updateRow("projects", user.id, match[1], { name: ensureString(input.name, "课题名称", 200), slug: slugify(input.name), field: ensureString(input.field, "学科或领域", 200), goal: ensureString(input.goal, "研究目标", 5000), language: input.language, paper_type: input.paperType, status: input.status, updated_at: new Date().toISOString() });
      return json(res, 200, { project: mapProject(project) });
    }

    match = path.match(/^\/projects\/([^/]+)\/sources\/upload-ticket$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]);
      const target = createSourceUploadTarget(user.id, match[1], await bodyJson(req));
      const signed = await storage().createSignedUploadUrl(target.path);
      if (signed.error || !signed.data?.token) throw new Error(signed.error?.message || "无法创建上传凭证");
      return json(res, 200, { sourceId: target.sourceId, path: target.path, token: signed.data.token });
    }
    match = path.match(/^\/projects\/([^/]+)\/sources\/upload-finalize$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]);
      const input = await bodyJson(req);
      const sourceId = ensureString(input.sourceId, "来源ID", 100);
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceId)) throw Object.assign(new Error("来源ID无效"), { statusCode: 400 });
      const file = validateSourceUpload(input);
      const blobPath = expectedSourceUploadPath(user.id, match[1], sourceId, file.name);
      if (input.path !== blobPath) throw Object.assign(new Error("上传文件路径不匹配"), { statusCode: 400 });
      const prefix = `${user.id}/${match[1]}/sources/${sourceId}`;
      const blobName = blobPath.slice(prefix.length + 1);
      const listed = await storage().list(prefix, { limit: 10, search: blobName });
      if (listed.error) throw new Error(listed.error.message);
      const uploaded = (listed.data || []).find((item) => item.name === blobName);
      if (!uploaded) throw Object.assign(new Error("未找到已上传的文件，请重新上传"), { statusCode: 409 });
      const actualSize = Number(uploaded.metadata?.size || file.size);
      if (actualSize > MAX_SOURCE_FILE_BYTES) {
        await storage().remove([blobPath]);
        throw Object.assign(new Error("单个文件最多 200MB，请压缩或拆分后重试"), { statusCode: 413 });
      }
      const source = await insertRow("sources", user.id, { id: sourceId, project_id: match[1], name: file.name, kind: "file", size: actualSize, status: "raw", mime_type: file.mimeType, blob_url: blobPath, processing_status: "registered" });
      return json(res, 201, { source: mapSource(source) });
    }
    match = path.match(/^\/projects\/([^/]+)\/sources$/);
    if (match && method === "POST") {
      const projectId = match[1]; await assertProject(user.id, projectId); const buffer = await rawBody(req);
      if (!buffer.length) throw Object.assign(new Error("上传文件为空"), { statusCode: 400 });
      if (buffer.length > MAX_SOURCE_FILE_BYTES) throw Object.assign(new Error("单个文件最多 200MB，请压缩或拆分后重试"), { statusCode: 413 });
      const url = new URL(req.url, "https://local.invalid"); const name = safeFileName(url.searchParams.get("name") || "source"); const mimeType = url.searchParams.get("type") || "application/octet-stream";
      const source = await insertRow("sources", user.id, { project_id: projectId, name, kind: "file", sha256: sha256(buffer), size: buffer.length, status: "raw", mime_type: mimeType, processing_status: "registered" });
      const blobPath = expectedSourceUploadPath(user.id, projectId, source.id, name); await storageUpload(blobPath, buffer, mimeType); const updated = await updateRow("sources", user.id, source.id, { blob_url: blobPath });
      return json(res, 201, { source: mapSource(updated) });
    }
    match = path.match(/^\/projects\/([^/]+)\/sources\/url$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]); const input = await bodyJson(req); const sourceUrl = ensureString(input.url, "网址", 2000); new URL(sourceUrl);
      const source = await insertRow("sources", user.id, { project_id: match[1], name: new URL(sourceUrl).hostname + new URL(sourceUrl).pathname, kind: "url", url: sourceUrl, status: "raw", processing_status: "registered" });
      return json(res, 201, { source: mapSource(source) });
    }

    match = path.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/process$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]);
      const source = await oneRow("sources", user.id, match[2]);
      if (source.project_id !== match[1]) throw Object.assign(new Error("来源不属于当前课题"), { statusCode: 403 });
      const processing = await updateRow("sources", user.id, source.id, { processing_status: "processing", failure_reason: null });
      try {
        await dispatchSource(user.id, match[1], source.id);
      } catch (error) {
        await updateRow("sources", user.id, source.id, { processing_status: "failed", failure_reason: error instanceof Error ? error.message : "资料处理任务未能排队" }).catch(() => {});
        throw error;
      }
      return json(res, 202, { source: mapSource(processing), duplicates: [], queued: true });
    }

    match = path.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/preview$/);
    if (match && method === "GET") {
      await assertProject(user.id, match[1]); const source = assertBelongs(await oneRow("sources", user.id, match[2]), match[1], "来源");
      const ppStructure = String(source.extracted_text || "").includes("parser:pp-structure-v3");
      return json(res, 200, { source: mapSource(source), content: source.extracted_text || "", note: ppStructure ? `已使用 PP-StructureV3 解析 ${source.ocr_pages || 0} 页并恢复阅读顺序、表格与公式；结果仍需逐页对照原件核验。` : source.ocr_used ? `已自动识别 ${source.ocr_pages || 0} 页扫描内容；OCR 文字可能存在误识别，请逐页对照原件核验。` : "这是自动抽取的纯文本预览；公式、表格、图片和版式仍以原件为准。" });
    }
    match = path.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/download$/);
    if (match && method === "GET") {
      await assertProject(user.id, match[1]); const source = assertBelongs(await oneRow("sources", user.id, match[2]), match[1], "来源"); const kind = new URL(req.url, "https://local.invalid").searchParams.get("kind") || "original";
      if (kind === "extracted") return binary(res, Buffer.from(source.extracted_text || ""), "text/markdown; charset=utf-8", `${safeFileName(source.title || source.name)}.md`);
      const target = source.kind === "file" ? source.blob_url : source.snapshot_url;
      if (!target) throw Object.assign(new Error("该来源尚无可下载的原件或快照"), { statusCode: 404 });
      return binary(res, await storageDownload(target), source.mime_type, basename(target));
    }
    match = path.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/verify$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]); const input = await bodyJson(req); const source = assertBelongs(await oneRow("sources", user.id, match[2]), match[1], "来源");
      if (!["metadata", "content", "reject"].includes(input.scope)) throw Object.assign(new Error("无效的来源核验范围"), { statusCode: 400 });
      if (input.scope === "content" && source.status !== "metadata-verified") throw Object.assign(new Error("请先确认元数据，再确认正文内容"), { statusCode: 409 });
      const metadata = input.metadata || {}; const values = { ...(metadata.title !== undefined ? { title: metadata.title } : {}), ...(metadata.authors !== undefined ? { authors: metadata.authors } : {}), ...(metadata.publicationYear !== undefined ? { publication_year: metadata.publicationYear } : {}), ...(metadata.venue !== undefined ? { venue: metadata.venue } : {}), ...(metadata.doi !== undefined ? { doi: metadata.doi } : {}) };
      if (input.scope === "reject") Object.assign(values, { status: "rejected", processing_status: "rejected" });
      else if (input.scope === "content") Object.assign(values, { status: "content-verified", processing_status: "content_verified", metadata_verified_at: new Date().toISOString() });
      else Object.assign(values, { status: "metadata-verified", processing_status: "metadata_verified", metadata_verified_at: new Date().toISOString() });
      return json(res, 200, { source: mapSource(await updateRow("sources", user.id, source.id, values)) });
    }
    match = path.match(/^\/projects\/([^/]+)\/sources\/([^/]+)$/);
    if (match && method === "DELETE") {
      await assertProject(user.id, match[1]); const source = assertBelongs(await oneRow("sources", user.id, match[2]), match[1], "来源");
      const linkedClaims = await listRows("evidence_claims", user.id, { source_id: source.id });
      if (linkedClaims.length) throw Object.assign(new Error(`该来源仍被 ${linkedClaims.length} 条证据卡引用，请先处理关联证据卡`), { statusCode: 409 });
      const paths = [source.blob_url, source.snapshot_url].filter(Boolean); if (paths.length) await storage().remove(paths);
      await deleteRow("sources", user.id, source.id); return json(res, 200, { deleted: true, trashPaths: [] });
    }

    match = path.match(/^\/projects\/([^/]+)\/evidence$/);
    if (match && method === "POST") {
      await assertProject(user.id, match[1]); const input = await bodyJson(req); const source = input.sourceId ? await oneRow("sources", user.id, input.sourceId) : null;
      const claimType = validateEvidenceInput(input, source, match[1]);
      const quoteText = String(input.quoteText || "").trim() || null;
      const claim = await insertRow("evidence_claims", user.id, { project_id: match[1], source_id: source?.id || null, claim_type: claimType, claim_text: ensureString(input.claimText, "证据表述", 10000), locator: String(input.locator || "").trim() || null, quote_text: quoteText, quote_sha256: quoteText ? sha256(Buffer.from(quoteText)) : null, verification_status: "pending", note: String(input.note || "").trim() || null });
      return json(res, 201, { claim: mapEvidence(claim) });
    }
    match = path.match(/^\/evidence\/([^/]+)\/review$/);
    if (match && method === "POST") {
      const input = await bodyJson(req); const current = await oneRow("evidence_claims", user.id, match[1]); const source = current.source_id ? await oneRow("sources", user.id, current.source_id) : null;
      validateEvidenceReview(input.status, current, source);
      const claim = await updateRow("evidence_claims", user.id, current.id, { verification_status: input.status, note: String(input.note || "").trim() || null, verified_at: input.status === "pending" ? null : new Date().toISOString() });
      return json(res, 200, { claim: mapEvidence(claim) });
    }
    match = path.match(/^\/evidence\/([^/]+)$/);
    if (match && method === "DELETE") { await deleteRow("evidence_claims", user.id, match[1]); return json(res, 200, { deleted: true }); }

    match = path.match(/^\/projects\/([^/]+)\/runs\/([^/]+)$/);
    if (match && method === "POST") { const input = await bodyJson(req); const run = await createRun(user.id, match[1], match[2], match[2] === "idea-evaluator" ? input : { instructions: input.instructions }); return json(res, 202, { run }); }
    match = path.match(/^\/runs\/([^/]+)$/);
    if (match && method === "GET") return json(res, 200, { run: mapRun(await oneRow("runs", user.id, match[1])) });
    if (match && method === "DELETE") { const run = await oneRow("runs", user.id, match[1]); if (["queued", "running"].includes(run.status)) throw Object.assign(new Error("请先取消运行再删除"), { statusCode: 409 }); await deleteRow("runs", user.id, run.id); return json(res, 200, { deleted: true, trashPath: null }); }
    match = path.match(/^\/runs\/([^/]+)\/cancel$/);
    if (match && method === "POST") { const run = await oneRow("runs", user.id, match[1]); const finished = ["completed", "failed", "cancelled"].includes(run.status); abortActiveRun(run.id); const updated = finished ? run : await updateRow("runs", user.id, run.id, { status: "cancelled", cancel_requested_at: new Date().toISOString(), completed_at: new Date().toISOString() }); return json(res, 200, { run: mapRun(updated), alreadyFinished: finished, relatedRunIds: [run.id] }); }
    match = path.match(/^\/runs\/([^/]+)\/retry$/);
    if (match && method === "POST") { const oldRun = await oneRow("runs", user.id, match[1]); await assertRunProject(user.id, oldRun); const run = await createRun(user.id, oldRun.project_id, oldRun.skill_name, JSON.parse(oldRun.input_json || "{}"), oldRun.id); return json(res, 202, { run }); }
    match = path.match(/^\/runs\/([^/]+)\/reviews$/);
    if (match && method === "POST") {
      const run = await oneRow("runs", user.id, match[1]); const input = await bodyJson(req);
      validateReviewDecision(input.decision, input.note);
      if (input.decision === "adopt") return json(res, 200, await adoptRun(user.id, run, input.note));
      if (input.decision === "request_revision") { const updated = await updateRow("runs", user.id, run.id, { review_status: "revision_requested", review_note: input.note || null, reviewed_at: new Date().toISOString() }); const nextInput = appendConversationTurn(JSON.parse(run.input_json || "{}"), run, input.note); const nextRun = await createRun(user.id, run.project_id, run.skill_name, nextInput, run.id); return json(res, 200, { run: mapRun(updated), nextRun, project: mapProject(await oneRow("projects", user.id, run.project_id)) }); }
      const updated = await updateRow("runs", user.id, run.id, { review_status: "rejected", review_note: input.note || null, reviewed_at: new Date().toISOString() }); return json(res, 200, { run: mapRun(updated), project: mapProject(await oneRow("projects", user.id, run.project_id)) });
    }

    match = path.match(/^\/projects\/([^/]+)\/exports$/);
    if (match && method === "GET") return json(res, 200, { files: (await listRows("exports", user.id, { project_id: match[1] }, { column: "created_at" })).map(mapExport) });
    if (match && method === "POST") {
      const project = await assertProject(user.id, match[1]); const input = await bodyJson(req); const format = input.format || "markdown"; const language = input.language || "zh"; const [versions, sources] = await Promise.all([listRows("stage_versions", user.id, { project_id: project.id }), listRows("sources", user.id, { project_id: project.id })]);
      if (!versions.some((item) => item.status === "active")) throw Object.assign(new Error("尚无人工采用的阶段版本，不能生成正式导出"), { statusCode: 409 });
      let translated = null;
      if (language === "en" && format !== "bibtex") {
        const configs = await listRows("model_configs", user.id, {}, { column: "updated_at" });
        translated = await translateExport(exportText(project, versions, "zh"), configs.find((item) => item.is_default), user.id);
      }
      const built = await buildExportBuffer(project, versions, format, language, sources, translated);
      const name = `${language === "en" ? "Research-Plan-English" : safeFileName(project.name)}-${Date.now()}.${built.ext}`;
      // Storage keys must not contain the user-facing Unicode filename.
      const blobUrl = `${user.id}/${project.id}/exports/${randomUUID()}.${built.ext}`;
      await storageUpload(blobUrl, built.buffer, built.mime);
      const item = await insertRow("exports", user.id, { project_id: project.id, name, format, language, blob_url: blobUrl, preview_text: built.preview.slice(0, 500_000), size: built.buffer.length, release_status: "formal" }); return json(res, 201, { path: item.id });
    }
    match = path.match(/^\/projects\/([^/]+)\/versions\/([^/]+)$/);
    if (match && method === "GET") {
      await assertProject(user.id, match[1]);
      const version = assertBelongs(await oneRow("stage_versions", user.id, match[2]), match[1], "正式版本");
      return json(res, 200, { content: version.content || "" });
    }
    match = path.match(/^\/projects\/([^/]+)\/exports\/preview$/);
    if (match && method === "GET") { await assertProject(user.id, match[1]); const id = new URL(req.url, "https://local.invalid").searchParams.get("path"); const item = assertBelongs(await oneRow("exports", user.id, id), match[1], "导出文件"); return json(res, 200, { file: mapExport(item), kind: mapExport(item).previewKind, content: item.preview_text || "", note: "预览仅用于快速检查；最终版式以下载文件为准。" }); }
    match = path.match(/^\/projects\/([^/]+)\/exports\/download$/);
    if (match && method === "GET") { await assertProject(user.id, match[1]); const id = new URL(req.url, "https://local.invalid").searchParams.get("path"); const item = assertBelongs(await oneRow("exports", user.id, id), match[1], "导出文件"); return binary(res, await storageDownload(item.blob_url), item.format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : item.format === "package" ? "application/zip" : "text/plain; charset=utf-8", item.name); }
    match = path.match(/^\/projects\/([^/]+)\/exports$/);
    if (match && method === "DELETE") { await assertProject(user.id, match[1]); const id = new URL(req.url, "https://local.invalid").searchParams.get("path"); const item = assertBelongs(await oneRow("exports", user.id, id), match[1], "导出文件"); await storage().remove([item.blob_url]); await deleteRow("exports", user.id, item.id); return json(res, 200, { deleted: true, trashPath: null }); }

    match = path.match(/^\/projects\/([^/]+)\/open-codex$/);
    if (match && method === "POST") { await assertProject(user.id, match[1]); throw Object.assign(new Error("云端模式由用户配置的模型 API 执行，不依赖 Codex Desktop。需要本地 Codex 时请使用本地版。"), { statusCode: 409 }); }
    if (path === "/system/backup" && method === "POST") throw Object.assign(new Error("在线数据已自动保存；当前版本不提供整库备份下载"), { statusCode: 409 });
    match = path.match(/^\/approvals\/([^/]+)$/);
    if (match && method === "POST") return json(res, 200, { ok: true });

    throw Object.assign(new Error("接口不存在"), { statusCode: 404 });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error instanceof Error ? error.message : "服务器错误" });
  }
}
