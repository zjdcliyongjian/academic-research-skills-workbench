import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";
import { advanceProjectStage, downstreamStages } from "./research-state.mjs";
import { isMigrationApplied, migrateStage15 } from "./schema.mjs";
import { isStage2MigrationApplied, migrateStage2 } from "./stage2-schema.mjs";

mkdirSync(DATA_DIR, { recursive: true });

const DATABASE_PATH = path.join(DATA_DIR, "workbench.sqlite");
export const db = new DatabaseSync(DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    field TEXT NOT NULL,
    goal TEXT NOT NULL,
    language TEXT NOT NULL,
    paper_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    stage TEXT NOT NULL DEFAULT 'brief',
    vault_root TEXT NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    relative_path TEXT,
    sha256 TEXT,
    size INTEGER,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'raw',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT,
    status TEXT NOT NULL,
    prompt TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    artifact_path TEXT,
    adopted_at TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    decision TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS product_feedback (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL,
    reproduction TEXT,
    expected TEXT,
    contact TEXT,
    context_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, created_at DESC);
`);
if (!isMigrationApplied(db)) {
  const backupDirectory = path.join(DATA_DIR, "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDirectory, `pre-stage-1.5-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
}
migrateStage15(db);
if (!isStage2MigrationApplied(db)) {
  const backupDirectory = path.join(DATA_DIR, "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDirectory, `pre-stage-2-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
}
migrateStage2(db);

function projectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    field: row.field,
    goal: row.goal,
    language: row.language,
    paperType: row.paper_type,
    status: row.status,
    stage: row.stage,
    vaultRoot: row.vault_root,
    projectPath: row.project_path,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceCount: Number(row.source_count || 0),
    runCount: Number(row.run_count || 0),
    latestRunStatus: row.latest_run_status || null,
  };
}

function sourceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    relativePath: row.relative_path,
    sha256: row.sha256,
    size: row.size,
    url: row.url,
    status: row.status,
    mimeType: row.mime_type,
    snapshotPath: row.snapshot_path,
    extractedPath: row.extracted_path,
    title: row.title,
    authors: row.authors_json ? JSON.parse(row.authors_json) : [],
    publicationYear: row.publication_year,
    venue: row.venue,
    doi: row.doi,
    processingStatus: row.processing_status || "registered",
    failureReason: row.failure_reason,
    processedAt: row.processed_at,
    metadataVerifiedAt: row.metadata_verified_at,
    createdAt: row.created_at,
  };
}

function evidenceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    claimType: row.claim_type,
    claimText: row.claim_text,
    locator: row.locator,
    quoteText: row.quote_text,
    quoteSha256: row.quote_sha256,
    verificationStatus: row.verification_status,
    note: row.note,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

function runFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    skillName: row.skill_name,
    threadId: row.thread_id,
    turnId: row.turn_id,
    status: row.status,
    prompt: row.prompt,
    output: row.output,
    artifactPath: row.artifact_path,
    adoptedAt: row.adopted_at,
    parentRunId: row.parent_run_id,
    cancelRequestedAt: row.cancel_requested_at,
    reviewStatus: row.review_status,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

function stageVersionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    versionNumber: row.version_number,
    runId: row.run_id,
    skillName: row.skill_name,
    relativePath: row.relative_path,
    contentSha256: row.content_sha256,
    status: row.status,
    adoptedAt: row.adopted_at,
    supersededAt: row.superseded_at,
  };
}

function approvalFromRow(row) {
  const payload = JSON.parse(row.payload_json);
  return {
    id: row.id,
    runId: row.run_id,
    method: row.method,
    reason: payload.reason || null,
    command: payload.command || null,
    cwd: payload.cwd || null,
    status: row.status,
    decision: row.decision,
    createdAt: row.created_at,
  };
}

const projectSelect = `
  SELECT p.*,
    (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id) AS source_count,
    (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count,
    (SELECT r2.status FROM runs r2 WHERE r2.project_id = p.id ORDER BY r2.started_at DESC LIMIT 1) AS latest_run_status
  FROM projects p
`;

export function createStore(database) {
  return {
  listProjects() {
    return database.prepare(`${projectSelect} ORDER BY p.updated_at DESC`).all().map(projectFromRow);
  },
  getProject(id) {
    return projectFromRow(database.prepare(`${projectSelect} WHERE p.id = ?`).get(id));
  },
  createProject(project) {
    database.prepare(`
      INSERT INTO projects (id, name, slug, field, goal, language, paper_type, status, stage, vault_root, project_path, thread_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, project.slug, project.field, project.goal,
      project.language, project.paperType, project.status, project.stage,
      project.vaultRoot, project.projectPath, project.threadId,
      project.createdAt, project.updatedAt,
    );
    return this.getProject(project.id);
  },
  updateProjectThread(id, threadId) {
    database.prepare("UPDATE projects SET thread_id = ?, updated_at = ? WHERE id = ?")
      .run(threadId, new Date().toISOString(), id);
    return this.getProject(id);
  },
  updateProjectStage(id, stage) {
    database.prepare("UPDATE projects SET stage = ?, updated_at = ? WHERE id = ?")
      .run(stage, new Date().toISOString(), id);
    return this.getProject(id);
  },
  updateProject(id, patch) {
    const allowed = { name: "name", field: "field", goal: "goal", language: "language", paperType: "paper_type", status: "status" };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getProject(id);
    database.prepare(`UPDATE projects SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
    return this.getProject(id);
  },
  diagnostics() {
    const integrityRow = database.prepare("PRAGMA integrity_check").get();
    return {
      integrity: Object.values(integrityRow || {})[0] || "unknown",
      projects: Number(database.prepare("SELECT COUNT(*) AS count FROM projects").get().count),
      sources: Number(database.prepare("SELECT COUNT(*) AS count FROM sources").get().count),
      runs: Number(database.prepare("SELECT COUNT(*) AS count FROM runs").get().count),
      pendingApprovals: Number(database.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'").get().count),
    };
  },
  createBackup() {
    const backupDirectory = path.join(DATA_DIR, "backups");
    mkdirSync(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const backupPath = path.join(backupDirectory, `manual-${stamp}.sqlite`);
    database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    return backupPath;
  },
  clearResearchData() {
    const count = (table) => Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    const counts = {
      projects: count("projects"),
      sources: count("sources"),
      evidenceClaims: count("evidence_claims"),
      runs: count("runs"),
      versions: count("stage_versions"),
      approvals: count("approvals"),
      feedback: count("feedback"),
      productFeedback: count("product_feedback"),
    };
    database.exec("BEGIN IMMEDIATE");
    try {
      // stage_versions.run_id is ON DELETE RESTRICT in the local schema.
      database.prepare("DELETE FROM stage_versions").run();
      database.prepare("DELETE FROM approvals").run();
      if (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_relations'").get()) {
        database.prepare("DELETE FROM source_relations").run();
      }
      database.prepare("DELETE FROM evidence_claims").run();
      database.prepare("DELETE FROM sources").run();
      database.prepare("DELETE FROM runs").run();
      database.prepare("DELETE FROM feedback").run();
      database.prepare("DELETE FROM product_feedback").run();
      database.prepare("DELETE FROM projects").run();
      database.exec("COMMIT");
      return counts;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  createProductFeedback(item) {
    database.prepare(`
      INSERT INTO product_feedback (
        id, project_id, category, title, details, reproduction, expected,
        contact, context_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.projectId || null, item.category, item.title, item.details,
      item.reproduction || null, item.expected || null, item.contact || null,
      JSON.stringify(item.context || {}), item.status, item.createdAt,
    );
    return { ...item };
  },
  listProductFeedback() {
    return database.prepare("SELECT * FROM product_feedback ORDER BY created_at DESC LIMIT 20").all().map((row) => ({
      id: row.id, projectId: row.project_id, category: row.category, title: row.title,
      details: row.details, reproduction: row.reproduction, expected: row.expected,
      contact: row.contact, context: JSON.parse(row.context_json || "{}"),
      status: row.status, createdAt: row.created_at,
    }));
  },
  listSources(projectId) {
    return database.prepare("SELECT * FROM sources WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId).map(sourceFromRow);
  },
  createSource(source) {
    database.prepare(`
      INSERT INTO sources (id, project_id, name, kind, relative_path, sha256, size, url, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id, source.projectId, source.name, source.kind, source.relativePath,
      source.sha256, source.size, source.url, source.status, source.createdAt,
    );
    database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), source.projectId);
    return sourceFromRow(database.prepare("SELECT * FROM sources WHERE id = ?").get(source.id));
  },
  getSource(id) {
    return sourceFromRow(database.prepare("SELECT * FROM sources WHERE id = ?").get(id));
  },
  updateSource(id, patch) {
    const allowed = {
      status: "status", mimeType: "mime_type", snapshotPath: "snapshot_path", extractedPath: "extracted_path",
      title: "title", authors: "authors_json", publicationYear: "publication_year", venue: "venue", doi: "doi",
      processingStatus: "processing_status", failureReason: "failure_reason", processedAt: "processed_at",
      metadataVerifiedAt: "metadata_verified_at", sha256: "sha256", size: "size",
    };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getSource(id);
    const values = entries.map(([key, value]) => key === "authors" ? JSON.stringify(value || []) : value);
    database.prepare(`UPDATE sources SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")} WHERE id = ?`).run(...values, id);
    const source = this.getSource(id);
    if (source) database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), source.projectId);
    return source;
  },
  deleteSource(id) {
    const source = this.getSource(id);
    if (!source) return null;
    if (source.processingStatus === "processing") throw new Error("正在处理的来源不能删除，请等待处理结束");
    const evidenceCount = Number(database.prepare("SELECT COUNT(*) AS count FROM evidence_claims WHERE source_id = ?").get(id).count);
    if (evidenceCount) throw new Error(`该来源仍被 ${evidenceCount} 条证据卡引用，请先处理关联证据卡`);
    database.prepare("DELETE FROM sources WHERE id = ?").run(id);
    database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), source.projectId);
    return source;
  },
  listEvidenceClaims(projectId) {
    return database.prepare("SELECT * FROM evidence_claims WHERE project_id = ? ORDER BY created_at DESC").all(projectId).map(evidenceFromRow);
  },
  createEvidenceClaim(claim) {
    database.prepare(`INSERT INTO evidence_claims (
      id, project_id, source_id, claim_type, claim_text, locator, quote_text, quote_sha256,
      verification_status, note, created_at, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(claim.id, claim.projectId, claim.sourceId || null, claim.claimType, claim.claimText, claim.locator || null,
        claim.quoteText || null, claim.quoteSha256 || null, claim.verificationStatus || "pending", claim.note || null,
        claim.createdAt, claim.verifiedAt || null);
    return evidenceFromRow(database.prepare("SELECT * FROM evidence_claims WHERE id = ?").get(claim.id));
  },
  updateEvidenceClaim(id, patch) {
    const allowed = { verificationStatus: "verification_status", note: "note", verifiedAt: "verified_at" };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return evidenceFromRow(database.prepare("SELECT * FROM evidence_claims WHERE id = ?").get(id));
    database.prepare(`UPDATE evidence_claims SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")} WHERE id = ?`)
      .run(...entries.map(([, value]) => value), id);
    return evidenceFromRow(database.prepare("SELECT * FROM evidence_claims WHERE id = ?").get(id));
  },
  getEvidenceClaim(id) {
    return evidenceFromRow(database.prepare("SELECT * FROM evidence_claims WHERE id = ?").get(id));
  },
  deleteEvidenceClaim(id) {
    const claim = this.getEvidenceClaim(id);
    if (!claim) return null;
    database.prepare("DELETE FROM evidence_claims WHERE id = ?").run(id);
    database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), claim.projectId);
    return claim;
  },
  listRuns(projectId) {
    return database.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC")
      .all(projectId).map(runFromRow);
  },
  getRun(id) {
    return runFromRow(database.prepare("SELECT * FROM runs WHERE id = ?").get(id));
  },
  createRun(run) {
    database.prepare(`
      INSERT INTO runs (id, project_id, skill_name, thread_id, turn_id, status, prompt, output, parent_run_id, review_status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.projectId, run.skillName, run.threadId, run.turnId, run.status, run.prompt, run.output || "", run.parentRunId || null, run.reviewStatus || "pending", run.startedAt);
    return this.getRun(run.id);
  },
  updateRun(id, patch) {
    const allowed = {
      threadId: "thread_id",
      turnId: "turn_id",
      status: "status",
      output: "output",
      artifactPath: "artifact_path",
      adoptedAt: "adopted_at",
      parentRunId: "parent_run_id",
      cancelRequestedAt: "cancel_requested_at",
      reviewStatus: "review_status",
      reviewedAt: "reviewed_at",
      reviewNote: "review_note",
      completedAt: "completed_at",
      error: "error",
    };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getRun(id);
    const sql = `UPDATE runs SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")} WHERE id = ?`;
    database.prepare(sql).run(...entries.map(([, value]) => value), id);
    const run = this.getRun(id);
    if (run) {
      database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), run.projectId);
    }
    return run;
  },
  deleteRun(id) {
    const run = this.getRun(id);
    if (!run) return null;
    if (["queued", "running", "waiting_approval"].includes(run.status)) throw new Error("运行中的任务不能删除，请先取消");
    if (run.reviewStatus === "adopted" || database.prepare("SELECT id FROM stage_versions WHERE run_id = ?").get(id)) {
      throw new Error("已形成正式版本的运行记录不能删除");
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE runs SET parent_run_id = NULL WHERE parent_run_id = ?").run(id);
      database.prepare("DELETE FROM runs WHERE id = ?").run(id);
      database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), run.projectId);
      database.exec("COMMIT");
      return run;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  recoverInterruptedRuns() {
    const active = database.prepare("SELECT id FROM runs WHERE status IN ('queued', 'running', 'waiting_approval') ORDER BY started_at ASC").all();
    if (!active.length) return [];
    const completedAt = new Date().toISOString();
    database.prepare(`
      UPDATE runs
      SET status = CASE WHEN cancel_requested_at IS NULL THEN 'failed' ELSE 'cancelled' END,
          error = CASE WHEN cancel_requested_at IS NULL THEN COALESCE(error, '工作台进程已重启，原运行已中断') ELSE error END,
          completed_at = COALESCE(completed_at, ?)
      WHERE status IN ('queued', 'running', 'waiting_approval')
    `).run(completedAt);
    return active.map(({ id }) => this.getRun(id)).filter(Boolean);
  },
  createApproval(approval) {
    database.prepare(`
      INSERT OR REPLACE INTO approvals (id, project_id, run_id, method, status, payload_json, decision, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approval.id, approval.projectId, approval.runId, approval.method,
      approval.status, JSON.stringify(approval.payload), approval.decision || null,
      approval.createdAt, approval.resolvedAt || null,
    );
    return approvalFromRow(database.prepare("SELECT * FROM approvals WHERE id = ?").get(approval.id));
  },
  resolveApproval(id, decision) {
    database.prepare("UPDATE approvals SET status = 'resolved', decision = ?, resolved_at = ? WHERE id = ?")
      .run(decision, new Date().toISOString(), id);
    return approvalFromRow(database.prepare("SELECT * FROM approvals WHERE id = ?").get(id));
  },
  listPendingApprovals(projectId) {
    return database.prepare("SELECT * FROM approvals WHERE project_id = ? AND status = 'pending' ORDER BY created_at DESC")
      .all(projectId).map(approvalFromRow);
  },
  listStageVersions(projectId, stage = null) {
    const rows = stage
      ? database.prepare("SELECT * FROM stage_versions WHERE project_id = ? AND stage = ? ORDER BY version_number DESC").all(projectId, stage)
      : database.prepare("SELECT * FROM stage_versions WHERE project_id = ? ORDER BY adopted_at DESC").all(projectId);
    return rows.map(stageVersionFromRow);
  },
  getActiveStageVersion(projectId, stage) {
    return stageVersionFromRow(database.prepare(`
      SELECT * FROM stage_versions WHERE project_id = ? AND stage = ? AND status = 'active'
    `).get(projectId, stage));
  },
  getStageVersion(id) {
    return stageVersionFromRow(database.prepare("SELECT * FROM stage_versions WHERE id = ?").get(id));
  },
  reviewRun(id, decision, note = null, reviewedAt = new Date().toISOString()) {
    const reviewStatus = ({ adopt: "adopted", reject: "rejected", request_revision: "revision_requested" })[decision];
    if (!reviewStatus) throw new Error("无效的内容审阅决定");
    database.prepare(`
      UPDATE runs SET review_status = ?, reviewed_at = ?, review_note = ? WHERE id = ?
    `).run(reviewStatus, reviewedAt, note, id);
    return this.getRun(id);
  },
  activateStageVersion(version) {
    const project = this.getProject(version.projectId);
    if (!project) throw new Error("项目不存在");
    const adoptedAt = version.adoptedAt || new Date().toISOString();
    const impactedStages = downstreamStages(version.stage).filter((stage) => stage !== "export");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        UPDATE stage_versions SET status = 'superseded', superseded_at = ?
        WHERE project_id = ? AND stage = ? AND status = 'active'
      `).run(adoptedAt, version.projectId, version.stage);
      for (const stage of impactedStages) {
        database.prepare(`
          UPDATE stage_versions SET status = 'needs_review'
          WHERE project_id = ? AND stage = ? AND status = 'active'
        `).run(version.projectId, stage);
      }
      const nextVersion = version.versionNumber || Number(database.prepare(`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
        FROM stage_versions WHERE project_id = ? AND stage = ?
      `).get(version.projectId, version.stage).next_version);
      database.prepare(`
        INSERT INTO stage_versions (
          id, project_id, stage, version_number, run_id, skill_name,
          relative_path, content_sha256, status, adopted_at, superseded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)
      `).run(
        version.id, version.projectId, version.stage, nextVersion, version.runId,
        version.skillName, version.relativePath, version.contentSha256 || null, adoptedAt,
      );
      database.prepare(`
        UPDATE runs
        SET review_status = 'adopted', reviewed_at = ?, review_note = ?, adopted_at = ?
        WHERE id = ?
      `).run(adoptedAt, version.reviewNote || null, adoptedAt, version.runId);
      const nextProjectStage = advanceProjectStage(project.stage, version.stage);
      database.prepare("UPDATE projects SET stage = ?, updated_at = ? WHERE id = ?")
        .run(nextProjectStage, adoptedAt, version.projectId);
      database.exec("COMMIT");
      return {
        version: stageVersionFromRow(database.prepare("SELECT * FROM stage_versions WHERE id = ?").get(version.id)),
        project: this.getProject(version.projectId),
        impactedStages,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  };
}

export const store = createStore(db);
