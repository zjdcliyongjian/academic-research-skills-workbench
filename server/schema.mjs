import { stageForSkill } from "./research-state.mjs";

export const STAGE_15_MIGRATION_ID = "stage-1.5-state-machine-v1";

export function isMigrationApplied(database, migrationId = STAGE_15_MIGRATION_ID) {
  const table = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get();
  if (!table) return false;
  return Boolean(database.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(migrationId));
}

function tableColumns(database, table) {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function ensureColumn(database, table, column, definition) {
  if (!tableColumns(database, table).has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateLegacyAdoptions(database) {
  const adoptedRuns = database.prepare(`
    SELECT id, project_id, skill_name, artifact_path, adopted_at
    FROM runs
    WHERE adopted_at IS NOT NULL
    ORDER BY project_id, adopted_at, started_at
  `).all();

  for (const run of adoptedRuns) {
    const stage = stageForSkill(run.skill_name);
    if (!stage) continue;
    database.prepare(`
      UPDATE runs
      SET review_status = 'adopted', reviewed_at = COALESCE(reviewed_at, adopted_at)
      WHERE id = ?
    `).run(run.id);

    const alreadyMigrated = database.prepare("SELECT id FROM stage_versions WHERE run_id = ?").get(run.id);
    if (alreadyMigrated) continue;

    const nextVersion = Number(database.prepare(`
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM stage_versions WHERE project_id = ? AND stage = ?
    `).get(run.project_id, stage).next_version);

    const adoptedAt = run.adopted_at;
    database.prepare(`
      UPDATE stage_versions
      SET status = 'superseded', superseded_at = COALESCE(superseded_at, ?)
      WHERE project_id = ? AND stage = ? AND status = 'active'
    `).run(adoptedAt, run.project_id, stage);

    database.prepare(`
      INSERT INTO stage_versions (
        id, project_id, stage, version_number, run_id, skill_name,
        relative_path, content_sha256, status, adopted_at, superseded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)
    `).run(
      `legacy-${run.id}`,
      run.project_id,
      stage,
      nextVersion,
      run.id,
      run.skill_name,
      run.artifact_path || "",
      adoptedAt,
    );
  }
}

export function migrateStage15(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    ensureColumn(database, "runs", "parent_run_id", "TEXT REFERENCES runs(id)");
    ensureColumn(database, "runs", "cancel_requested_at", "TEXT");
    ensureColumn(database, "runs", "review_status", "TEXT NOT NULL DEFAULT 'pending'");
    ensureColumn(database, "runs", "reviewed_at", "TEXT");
    ensureColumn(database, "runs", "review_note", "TEXT");

    database.exec(`
      CREATE TABLE IF NOT EXISTS stage_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
        skill_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        adopted_at TEXT NOT NULL,
        superseded_at TEXT,
        UNIQUE(project_id, stage, version_number)
      );

      CREATE INDEX IF NOT EXISTS idx_stage_versions_project
        ON stage_versions(project_id, stage, version_number DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_versions_active
        ON stage_versions(project_id, stage) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
      CREATE INDEX IF NOT EXISTS idx_runs_review ON runs(project_id, review_status, started_at DESC);
    `);

    migrateLegacyAdoptions(database);
    database.prepare(`
      INSERT OR IGNORE INTO schema_migrations (id, applied_at)
      VALUES (?, ?)
    `).run(STAGE_15_MIGRATION_ID, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
