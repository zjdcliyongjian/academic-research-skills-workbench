import { createClient } from "@supabase/supabase-js";
import { buildProjectReadiness } from "../server/trial-readiness.mjs";

let client;
export function adminClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("在线服务配置不完整");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function assertResult(result, fallback = "数据库操作失败") {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export async function authenticate(req) {
  const authorization = String(req.headers.authorization || req.headers.Authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw Object.assign(new Error("请先登录"), { statusCode: 401 });
  const result = await adminClient().auth.getUser(token);
  if (result.error || !result.data.user) throw Object.assign(new Error("登录状态已失效，请重新登录"), { statusCode: 401 });
  const user = result.data.user;
  const profileResult = await adminClient().from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profile = profileResult.data;
  if (!profile) throw Object.assign(new Error("账号资料不存在，请联系管理员"), { statusCode: 403 });
  if (profile.status === "disabled") throw Object.assign(new Error("账号已被管理员禁用"), { statusCode: 403 });
  if (profile.force_logout_at && user.last_sign_in_at && new Date(user.last_sign_in_at) <= new Date(profile.force_logout_at)) {
    throw Object.assign(new Error("管理员已结束本次登录，请重新登录"), { statusCode: 401 });
  }
  user.profile = profile;
  return user;
}

export function assertAdmin(user) {
  if (user?.app_metadata?.role !== "admin" || user?.profile?.role !== "admin") {
    throw Object.assign(new Error("需要管理员权限"), { statusCode: 403 });
  }
  return user;
}

export async function listRows(table, ownerId, filters = {}, order = null, columns = "*") {
  let query = adminClient().from(table).select(columns).eq("owner_id", ownerId);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
  return assertResult(await query);
}

export async function oneRow(table, ownerId, id, columns = "*") {
  const data = assertResult(await adminClient().from(table).select(columns).eq("owner_id", ownerId).eq("id", id).maybeSingle());
  if (!data) throw Object.assign(new Error("记录不存在或无权访问"), { statusCode: 404 });
  return data;
}

export async function insertRow(table, ownerId, values) {
  return assertResult(await adminClient().from(table).insert({ ...values, owner_id: ownerId }).select("*").single());
}

export async function updateRow(table, ownerId, id, values) {
  const data = assertResult(await adminClient().from(table).update(values).eq("owner_id", ownerId).eq("id", id).select("*").maybeSingle());
  if (!data) throw Object.assign(new Error("记录不存在或无权访问"), { statusCode: 404 });
  return data;
}

export async function deleteRow(table, ownerId, id) {
  const data = assertResult(await adminClient().from(table).delete().eq("owner_id", ownerId).eq("id", id).select("id").maybeSingle());
  if (!data) throw Object.assign(new Error("记录不存在或无权访问"), { statusCode: 404 });
  return data;
}

export async function projectBundle(ownerId, projectId, { includeContent = false } = {}) {
  const projectColumns = "id,owner_id,name,slug,field,goal,language,paper_type,status,stage,created_at,updated_at";
  const sourceColumns = includeContent
    ? "*"
    : "id,owner_id,project_id,name,kind,blob_url,sha256,size,url,status,mime_type,snapshot_url,title,authors,publication_year,venue,doi,processing_status,failure_reason,ocr_used,ocr_pages,processed_at,metadata_verified_at,created_at";
  const evidenceColumns = "id,owner_id,project_id,source_id,claim_type,claim_text,locator,quote_text,quote_sha256,verification_status,note,created_at,verified_at";
  const versionColumns = includeContent
    ? "*"
    : "id,owner_id,project_id,stage,version_number,run_id,skill_name,content_sha256,status,adopted_at,superseded_at";
  const [project, sources, evidenceClaims, runs, versions] = await Promise.all([
    oneRow("projects", ownerId, projectId, projectColumns),
    listRows("sources", ownerId, { project_id: projectId }, { column: "created_at" }, sourceColumns),
    listRows("evidence_claims", ownerId, { project_id: projectId }, { column: "created_at" }, evidenceColumns),
    listRows("runs", ownerId, { project_id: projectId }, { column: "started_at" }),
    listRows("stage_versions", ownerId, { project_id: projectId }, { column: "adopted_at" }, versionColumns),
  ]);
  return { project, sources, evidenceClaims, runs, versions };
}

export function mapProject(row, counts = {}) {
  return {
    id: row.id, name: row.name, slug: row.slug, field: row.field, goal: row.goal,
    language: row.language, paperType: row.paper_type, status: row.status, stage: row.stage,
    vaultRoot: "用户专属资料空间", projectPath: `${row.owner_id}/${row.id}`,
    threadId: null, createdAt: row.created_at, updatedAt: row.updated_at,
    sourceCount: counts.sourceCount || 0, runCount: counts.runCount || 0, latestRunStatus: counts.latestRunStatus || null,
  };
}

export function mapSource(row) {
  return {
    id: row.id, projectId: row.project_id, name: row.name, kind: row.kind,
    relativePath: row.blob_url, sha256: row.sha256, size: row.size, url: row.url, status: row.status,
    mimeType: row.mime_type, snapshotPath: row.snapshot_url || null,
    extractedPath: row.extracted_text !== undefined
      ? (row.extracted_text ? `database:${row.id}` : null)
      : (row.processed_at ? `database:${row.id}` : null),
    title: row.title, authors: Array.isArray(row.authors) ? row.authors : [], publicationYear: row.publication_year,
    venue: row.venue, doi: row.doi, processingStatus: row.processing_status, failureReason: row.failure_reason,
    ocrUsed: Boolean(row.ocr_used), ocrPages: Number(row.ocr_pages || 0),
    processedAt: row.processed_at, metadataVerifiedAt: row.metadata_verified_at, createdAt: row.created_at,
  };
}

export function mapEvidence(row) {
  return {
    id: row.id, projectId: row.project_id, sourceId: row.source_id, claimType: row.claim_type,
    claimText: row.claim_text, locator: row.locator, quoteText: row.quote_text, quoteSha256: row.quote_sha256,
    verificationStatus: row.verification_status, note: row.note, createdAt: row.created_at, verifiedAt: row.verified_at,
  };
}

export function mapRun(row) {
  return {
    id: row.id, projectId: row.project_id, skillName: row.skill_name, threadId: `cloud:${row.id}`, turnId: null,
    status: row.status, prompt: row.prompt, output: row.output || "", artifactPath: null,
    adoptedAt: row.adopted_at, parentRunId: row.parent_run_id, cancelRequestedAt: row.cancel_requested_at,
    reviewStatus: row.review_status, reviewedAt: row.reviewed_at, reviewNote: row.review_note,
    startedAt: row.started_at, completedAt: row.completed_at, error: row.error,
  };
}

export function mapVersion(row) {
  return {
    id: row.id, projectId: row.project_id, stage: row.stage, versionNumber: row.version_number,
    runId: row.run_id, skillName: row.skill_name, relativePath: `private:stage_versions/${row.id}`,
    contentSha256: row.content_sha256, status: row.status, adoptedAt: row.adopted_at, supersededAt: row.superseded_at,
  };
}

export async function mappedProjectDetail(ownerId, projectId) {
  const bundle = await projectBundle(ownerId, projectId);
  const mapped = {
    project: mapProject(bundle.project, {
      sourceCount: bundle.sources.length,
      runCount: bundle.runs.length,
      latestRunStatus: bundle.runs[0]?.status || null,
    }),
    sources: bundle.sources.map(mapSource),
    evidenceClaims: bundle.evidenceClaims.map(mapEvidence),
    runs: bundle.runs.map(mapRun), approvals: [], versions: bundle.versions.map(mapVersion),
  };
  mapped.readiness = buildProjectReadiness(mapped.project, mapped.sources, mapped.evidenceClaims, mapped.runs, mapped.versions);
  return mapped;
}

export async function ownerCounts(ownerId) {
  const tables = ["projects", "sources", "runs"];
  const counts = await Promise.all(tables.map((table) => adminClient().from(table).select("id", { count: "exact", head: true }).eq("owner_id", ownerId)));
  counts.forEach((result) => assertResult(result));
  const pending = await adminClient().from("runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("status", ["queued", "running"]);
  assertResult(pending);
  return { projects: counts[0].count || 0, sources: counts[1].count || 0, runs: counts[2].count || 0, pendingApprovals: pending.count || 0 };
}
