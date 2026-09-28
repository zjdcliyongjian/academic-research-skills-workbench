export const STAGE_2_MIGRATION_ID = "stage-2-lifecycle-v1";

function columns(database, table) {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function ensureColumn(database, table, column, definition) {
  if (!columns(database, table).has(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function isStage2MigrationApplied(database) {
  return Boolean(database.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(STAGE_2_MIGRATION_ID));
}

export function migrateStage2(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    ensureColumn(database, "sources", "mime_type", "TEXT");
    ensureColumn(database, "sources", "snapshot_path", "TEXT");
    ensureColumn(database, "sources", "extracted_path", "TEXT");
    ensureColumn(database, "sources", "title", "TEXT");
    ensureColumn(database, "sources", "authors_json", "TEXT");
    ensureColumn(database, "sources", "publication_year", "INTEGER");
    ensureColumn(database, "sources", "venue", "TEXT");
    ensureColumn(database, "sources", "doi", "TEXT");
    ensureColumn(database, "sources", "processing_status", "TEXT NOT NULL DEFAULT 'registered'");
    ensureColumn(database, "sources", "failure_reason", "TEXT");
    ensureColumn(database, "sources", "processed_at", "TEXT");
    ensureColumn(database, "sources", "metadata_verified_at", "TEXT");

    database.exec(`
      CREATE TABLE IF NOT EXISTS evidence_claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        claim_type TEXT NOT NULL,
        claim_text TEXT NOT NULL,
        locator TEXT,
        quote_text TEXT,
        quote_sha256 TEXT,
        verification_status TEXT NOT NULL DEFAULT 'pending',
        note TEXT,
        created_at TEXT NOT NULL,
        verified_at TEXT
      );

      CREATE TABLE IF NOT EXISTS source_relations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        related_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, related_source_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence_claims(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence_claims(source_id);
      CREATE INDEX IF NOT EXISTS idx_source_doi ON sources(project_id, doi);
      CREATE INDEX IF NOT EXISTS idx_source_hash ON sources(project_id, sha256);
    `);

    database.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run(STAGE_2_MIGRATION_ID, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

