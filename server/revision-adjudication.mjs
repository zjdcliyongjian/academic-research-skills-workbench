import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKBENCH_DRAFT_SCHEMA = "ars-workbench-author-adjudication-draft/1.0";

function directory(project) { return path.join(project.projectPath, "10-passport", "revision"); }
function roadmapPath(project) { return path.join(directory(project), "revision-roadmap.json"); }
function draftPath(project) { return path.join(directory(project), "author-adjudication-draft.json"); }
function exportPath(project) { return path.join(directory(project), "author-adjudication-input.json"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function exists(target) { try { await access(target); return true; } catch { return false; } }

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function validateRoadmap(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["返修路线顶层必须是 JSON 对象"];
  if (document.schema_version !== "revision-roadmap/1.0") errors.push("schema_version 必须是 revision-roadmap/1.0");
  if (!Number.isInteger(document.revision_round) || document.revision_round < 1) errors.push("revision_round 必须是大于等于 1 的整数");
  for (const field of ["base_draft_sha256", "block_manifest_sha256"]) {
    if (!/^[0-9a-f]{64}$/.test(String(document[field] || ""))) errors.push(`${field} 必须是 64 位小写 SHA-256`);
  }
  if (!Array.isArray(document.items)) errors.push("items 必须是数组");
  else {
    const ids = new Set();
    document.items.forEach((item, index) => {
      const prefix = `items[${index}]`;
      if (!item || typeof item !== "object") { errors.push(`${prefix} 必须是对象`); return; }
      if (!/^REV-[A-Za-z0-9-]+$/.test(String(item.id || ""))) errors.push(`${prefix}.id 不符合 REV-* 规则`);
      else if (ids.has(item.id)) errors.push(`${prefix}.id 重复：${item.id}`);
      else ids.add(item.id);
      for (const field of ["description", "reviewer", "target_section", "suggested_action", "verification_criteria"]) {
        if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${prefix}.${field} 必须是非空字符串`);
      }
      if (!["must_fix", "should_fix", "consider"].includes(item.obligation_class)) errors.push(`${prefix}.obligation_class 无效`);
      if (!Array.isArray(item.proposed_targets) || !item.proposed_targets.length) errors.push(`${prefix}.proposed_targets 不能为空`);
      else item.proposed_targets.forEach((target, targetIndex) => {
        if (!/^(?:B[0-9]{4,}|DOC-BODY-START)$/.test(String(target?.block_id || ""))) errors.push(`${prefix}.proposed_targets[${targetIndex}].block_id 无效`);
        if (!Array.isArray(target?.allowed_operations) || !target.allowed_operations.length || target.allowed_operations.some((op) => !["replace_block", "insert_after", "delete_block"].includes(op))) errors.push(`${prefix}.proposed_targets[${targetIndex}].allowed_operations 无效`);
      });
    });
    if (Number(document.total_items) !== document.items.length) errors.push("total_items 与 items 数量不一致");
  }
  return errors;
}

function publicRoadmap(document, importedAt, contentSha256) {
  return {
    schemaVersion: document.schema_version,
    revisionRound: document.revision_round,
    baseDraftSha256: document.base_draft_sha256,
    blockManifestSha256: document.block_manifest_sha256,
    totalItems: document.total_items,
    editorialDecision: document.editorial_decision,
    importedAt,
    contentSha256,
    items: document.items.map((item) => ({
      id: item.id,
      description: item.description,
      reviewer: item.reviewer,
      obligationClass: item.obligation_class,
      targetSection: item.target_section,
      suggestedAction: item.suggested_action,
      verificationCriteria: item.verification_criteria,
      proposedTargets: item.proposed_targets,
    })),
  };
}

async function loadRoadmap(project) {
  const target = roadmapPath(project);
  if (!(await exists(target))) return null;
  const raw = await readFile(target, "utf8");
  const document = JSON.parse(raw);
  return { raw, document, path: target };
}

async function loadDraft(project) {
  const target = draftPath(project);
  if (!(await exists(target))) return { schema_version: WORKBENCH_DRAFT_SCHEMA, decisions: [], updated_at: null };
  return JSON.parse(await readFile(target, "utf8"));
}

export async function importRevisionRoadmap(project, content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("请选择非空 revision-roadmap JSON 文件");
  let document;
  try { document = JSON.parse(content); } catch (error) { throw new Error(`返修路线 JSON 无法解析：${error.message}`); }
  const errors = validateRoadmap(document);
  if (errors.length) {
    const error = new Error(`返修路线未通过核心合约检查：${errors.slice(0, 5).join("；")}`);
    error.details = errors;
    throw error;
  }
  await mkdir(directory(project), { recursive: true });
  await writeFile(roadmapPath(project), content, "utf8");
  await writeJsonAtomic(draftPath(project), {
    schema_version: WORKBENCH_DRAFT_SCHEMA,
    roadmap_sha256: sha256(content),
    imported_at: new Date().toISOString(),
    decisions: [],
    updated_at: new Date().toISOString(),
    boundary: "这是作者裁决工作草稿；未生成 author-adjudication/1.0，也不授予修改权限。",
  });
  return readRevisionWorkspace(project);
}

export async function readRevisionWorkspace(project) {
  const loaded = await loadRoadmap(project);
  if (!loaded) return { roadmap: null, decisions: [], complete: false, exportReady: false, boundary: "请先导入上游 revision-roadmap/1.0。" };
  const draft = await loadDraft(project);
  const importedAt = draft.imported_at || null;
  const contentSha256 = sha256(loaded.raw);
  const itemIds = new Set(loaded.document.items.map((item) => item.id));
  const decisions = (draft.decisions || []).filter((decision) => itemIds.has(decision.item_id)).map((decision) => ({
    itemId: decision.item_id,
    authorTriage: decision.author_triage,
    authorReason: decision.author_reason || null,
    authorizedTargets: decision.authorized_targets || [],
    authorEventId: decision.author_event_id,
    recordedAt: decision.recorded_at,
  }));
  return {
    roadmap: publicRoadmap(loaded.document, importedAt, contentSha256),
    decisions,
    complete: decisions.length === loaded.document.items.length,
    exportReady: Boolean(draft.finalized_at && await exists(exportPath(project))),
    exportedRelativePath: draft.finalized_at ? path.relative(project.projectPath, exportPath(project)).replaceAll("\\", "/") : null,
    boundary: "只有带作者原话收据的逐项决定会进入导出输入；导出文件仍需上游 builder 绑定 base draft、block manifest 与 claim surface 后，才能成为 author-adjudication/1.0。",
  };
}

export async function saveRevisionDecision(project, itemId, input) {
  const loaded = await loadRoadmap(project);
  if (!loaded) throw new Error("请先导入 revision-roadmap/1.0");
  const item = loaded.document.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("返修项目不存在");
  const triage = input.authorTriage;
  if (!["will_address", "wont_address", "not_on_point"].includes(triage)) throw new Error("无效的作者裁决");
  const authorWords = String(input.authorWords || "").trim();
  if (!authorWords) throw new Error("请填写本次裁决的作者原话，系统只记录，不代写决定");
  const requestedTargets = Array.isArray(input.authorizedTargets) ? input.authorizedTargets : [];
  const allowedByBlock = new Map(item.proposed_targets.map((target) => [target.block_id, new Set(target.allowed_operations)]));
  const authorizedTargets = requestedTargets.map((target) => ({ block_id: target.blockId, allowed_operations: [...new Set(target.allowedOperations || [])] }));
  if (triage === "will_address" && !authorizedTargets.length) throw new Error("will_address 必须至少选择一个明确修改目标");
  if (triage !== "will_address" && authorizedTargets.length) throw new Error("拒绝或认为不相关时不能授权修改目标");
  for (const target of authorizedTargets) {
    const allowedOps = allowedByBlock.get(target.block_id);
    if (!allowedOps || !target.allowed_operations.length || target.allowed_operations.some((op) => !allowedOps.has(op))) throw new Error(`目标 ${target.block_id} 超出 reviewer 提议范围`);
  }
  const reason = String(input.authorReason || "").trim();
  if (triage !== "will_address" && !reason) throw new Error("wont_address / not_on_point 必须填写作者理由");
  const eventId = `AUTHOR-EVENT-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const draft = await loadDraft(project);
  const decision = {
    item_id: itemId,
    author_event_id: eventId,
    author_event: { event_id: eventId, source: "explicit_session_user_message", actor_role: "author", input_sha256: sha256(authorWords) },
    author_words: authorWords,
    author_triage: triage,
    ...(reason ? { author_reason: reason } : {}),
    authorized_targets: authorizedTargets,
    claim_strength_authorizations: [],
    recorded_at: new Date().toISOString(),
  };
  draft.decisions = [...(draft.decisions || []).filter((entry) => entry.item_id !== itemId), decision];
  draft.updated_at = new Date().toISOString();
  delete draft.finalized_at;
  await writeJsonAtomic(draftPath(project), draft);
  if (await exists(exportPath(project))) await writeFile(exportPath(project), "", "utf8");
  return readRevisionWorkspace(project);
}

export async function finalizeRevisionInput(project, authorWords) {
  const words = String(authorWords || "").trim();
  if (!words) throw new Error("请用作者原话确认显示顺序与全部裁决");
  const loaded = await loadRoadmap(project);
  const draft = await loadDraft(project);
  if (!loaded) throw new Error("请先导入 revision-roadmap/1.0");
  const byId = new Map((draft.decisions || []).map((decision) => [decision.item_id, decision]));
  if (loaded.document.items.some((item) => !byId.has(item.id))) throw new Error("仍有返修项目没有作者裁决");
  const orderEventId = `AUTHOR-EVENT-${Date.now()}-${randomUUID().slice(0, 8)}-order`;
  const ordered = loaded.document.items.map((item) => byId.get(item.id));
  const authorInput = {
    schema_version: "author-adjudication-input/1.0",
    author_events: [
      ...ordered.map((decision) => decision.author_event),
      { event_id: orderEventId, source: "explicit_session_user_message", actor_role: "author", input_sha256: sha256(words) },
    ],
    display_order: { mode: "source_traceability", item_ids: loaded.document.items.map((item) => item.id), author_event_id: orderEventId },
    author_adjudications: ordered.map((decision) => ({
      item_id: decision.item_id,
      author_event_id: decision.author_event_id,
      author_triage: decision.author_triage,
      ...(decision.author_reason ? { author_reason: decision.author_reason } : {}),
      authorized_targets: decision.authorized_targets,
      claim_strength_authorizations: [],
    })),
    collateral_authorizations: [],
  };
  await writeJsonAtomic(exportPath(project), authorInput);
  draft.finalized_at = new Date().toISOString();
  draft.final_confirmation_sha256 = sha256(words);
  draft.updated_at = draft.finalized_at;
  await writeJsonAtomic(draftPath(project), draft);
  return readRevisionWorkspace(project);
}

export async function readRevisionInput(project) {
  const target = exportPath(project);
  if (!(await exists(target))) throw new Error("尚未生成 author-adjudication-input/1.0");
  const buffer = await readFile(target);
  if (!buffer.length) throw new Error("作者裁决输入已因后续修改失效，请重新确认导出");
  return { target, buffer };
}
