import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { materialPassportPath, readRunLedgerReport, runLedgerPath, runLedgerRuntime } from "./ars-ledger.mjs";

export const WORKBENCH_PASSPORT_SCHEMA = "ars-workbench-material-passport/1.0";

function relative(project, target) {
  return path.relative(project.projectPath, target).replaceAll("\\", "/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function checkpointForRun(run) {
  if (!run.completedAt) return null;
  return {
    id: `run-review-${run.id}`,
    run_id: run.id,
    stage: run.skillName,
    status: run.reviewStatus === "pending" && run.status === "completed" ? "open" : "closed",
    decision: run.reviewStatus === "pending" ? null : run.reviewStatus,
    decided_at: run.reviewedAt || null,
    note: run.reviewNote || null,
  };
}

export function buildMaterialPassport({ project, sources, evidenceClaims, runs, versions, approvals, ledger, generatedAt = new Date().toISOString() }) {
  const sourceRows = sources.map((source) => ({
    source_id: source.id,
    name: source.name,
    kind: source.kind,
    locator: source.relativePath || source.url,
    sha256: source.sha256,
    status: source.status,
    processing_status: source.processingStatus,
    bibliographic_identity: {
      title: source.title,
      authors: source.authors,
      publication_year: source.publicationYear,
      venue: source.venue,
      doi: source.doi,
    },
    human_read_status: "not_recorded",
    boundary_note: "工作台未从文件存在或正文提取推断研究者已阅读。",
  }));
  const claims = evidenceClaims.map((claim) => ({
    claim_id: claim.id,
    source_id: claim.sourceId,
    claim_type: claim.claimType,
    claim_text: claim.claimText,
    locator: claim.locator,
    quote_sha256: claim.quoteSha256,
    verification_status: claim.verificationStatus,
    verified_at: claim.verifiedAt,
    note: claim.note,
  }));
  const versionRows = versions.map((version) => ({
    version_id: version.id,
    stage: version.stage,
    version_number: version.versionNumber,
    run_id: version.runId,
    skill_name: version.skillName,
    path: version.relativePath,
    content_sha256: version.contentSha256,
    status: version.status,
    adopted_at: version.adoptedAt,
    superseded_at: version.supersededAt,
  }));
  const runRows = runs.map((run) => ({
    run_id: run.id,
    skill_name: run.skillName,
    status: run.status,
    review_status: run.reviewStatus,
    parent_run_id: run.parentRunId,
    artifact_path: run.artifactPath,
    started_at: run.startedAt,
    completed_at: run.completedAt,
  }));
  const checkpoints = runs.map(checkpointForRun).filter(Boolean);
  const unresolvedClaims = claims.filter((claim) => claim.verification_status !== "verified").length;
  const passport = {
    schema_version: WORKBENCH_PASSPORT_SCHEMA,
    projection_scope: "WORKBENCH_PROJECTION",
    generated_at: generatedAt,
    project: {
      project_id: project.id,
      name: project.name,
      field: project.field,
      goal: project.goal,
      stage: project.stage,
      status: project.status,
      language: project.language,
      paper_type: project.paperType,
      project_path: project.projectPath,
      thread_id: project.threadId,
    },
    provenance: {
      origin_skill: "academic-research-suite",
      origin_mode: "workbench-integration",
      origin_date: project.createdAt,
      version_label: `workbench-${project.updatedAt}`,
      verification_status: "UNVERIFIED",
      slr_lineage: "unknown",
    },
    counts: {
      sources: sourceRows.length,
      content_verified_sources: sourceRows.filter((source) => source.status === "content-verified").length,
      claims: claims.length,
      verified_claims: claims.filter((claim) => claim.verification_status === "verified").length,
      unresolved_claims: unresolvedClaims,
      runs: runRows.length,
      active_versions: versionRows.filter((version) => version.status === "active").length,
      needs_review_versions: versionRows.filter((version) => version.status === "needs_review").length,
      open_checkpoints: checkpoints.filter((checkpoint) => checkpoint.status === "open").length,
      pending_tool_approvals: approvals.length,
    },
    literature_corpus_projection: sourceRows,
    claim_registry_projection: claims,
    version_registry: versionRows,
    run_registry: runRows,
    author_checkpoints: checkpoints,
    run_ledger: ledger,
    terminal_policies: {
      status: "not_configured",
      note: "工作台没有替研究者启用任何 ARS terminal policy。",
    },
    boundaries: [
      "这是工作台对本地数据库与 Vault 的确定性投影，不声称符合上游 Material Passport Schema 9。",
      "UNVERIFIED 表示尚不能据此确认 Stage 2.5 或 Stage 4.5 已通过。",
      "文件存在、正文已提取或来源已核验都不等于研究者已阅读全文。",
      "该文件和 run ledger 是可追溯收据，不是论文正确性、原创性或可发表性的证书。",
    ],
  };
  const canonical = JSON.stringify(passport);
  return { ...passport, projection_sha256: sha256(canonical) };
}

async function writeAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function ledgerUnavailable(project, error) {
  const runtime = runLedgerRuntime();
  return {
    status: "unavailable",
    ledger_path: relative(project, runLedgerPath(project)),
    script_path: runtime.script,
    entries: 0,
    backed: 0,
    awaiting_answer: [],
    cannot_confirm: [],
    not_run: [],
    missing: [],
    counters: {},
    diagnostic: error instanceof Error ? error.message : String(error),
  };
}

function ledgerProjection(project, report) {
  return {
    status: report.ledger_status,
    ledger_path: relative(project, runLedgerPath(project)),
    entries: report.entries,
    backed: report.backed,
    awaiting_answer: report.awaiting_answer,
    cannot_confirm: report.cannot_confirm,
    not_run: report.not_run,
    missing: report.missing,
    counters: report.counters,
    step_outcomes: report.step_outcomes,
    untrusted_from_seq: report.untrusted_from_seq,
    diagnostic: report.detail,
  };
}

export async function syncMaterialPassport({ project, sources, evidenceClaims, runs, versions, approvals }) {
  const target = materialPassportPath(project);
  const seedLedger = {
    status: "checking",
    ledger_path: relative(project, runLedgerPath(project)),
    entries: 0,
    backed: 0,
    awaiting_answer: [],
    cannot_confirm: [],
    not_run: [],
    missing: [],
    counters: {},
  };
  const seed = buildMaterialPassport({ project, sources, evidenceClaims, runs, versions, approvals, ledger: seedLedger });
  await writeAtomic(target, seed);
  let ledger;
  try {
    ledger = ledgerProjection(project, await readRunLedgerReport(project));
  } catch (error) {
    ledger = ledgerUnavailable(project, error);
  }
  const passport = buildMaterialPassport({ project, sources, evidenceClaims, runs, versions, approvals, ledger });
  await writeAtomic(target, passport);
  return { passport, path: target };
}

export async function syncProjectPassport(store, projectId) {
  const project = store.getProject(projectId);
  if (!project) throw new Error("项目不存在");
  return syncMaterialPassport({
    project,
    sources: store.listSources(projectId),
    evidenceClaims: store.listEvidenceClaims(projectId),
    runs: store.listRuns(projectId),
    versions: store.listStageVersions(projectId),
    approvals: store.listPendingApprovals(projectId),
  });
}
