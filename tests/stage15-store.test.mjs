import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStore } from "../server/db.mjs";
import { migrateStage15 } from "../server/schema.mjs";
import { migrateStage2 } from "../server/stage2-schema.mjs";

function legacyDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, field TEXT NOT NULL,
      goal TEXT NOT NULL, language TEXT NOT NULL, paper_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', stage TEXT NOT NULL DEFAULT 'brief',
      vault_root TEXT NOT NULL, project_path TEXT NOT NULL UNIQUE, thread_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE sources (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, relative_path TEXT, sha256 TEXT, size INTEGER,
      url TEXT, status TEXT NOT NULL DEFAULT 'raw', created_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      skill_name TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT, status TEXT NOT NULL,
      prompt TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', artifact_path TEXT, adopted_at TEXT,
      started_at TEXT NOT NULL, completed_at TEXT, error TEXT
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, method TEXT NOT NULL,
      status TEXT NOT NULL, payload_json TEXT NOT NULL, decision TEXT,
      created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE feedback (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE product_feedback (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL,
      reproduction TEXT, expected TEXT, contact TEXT, context_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return database;
}

function insertProject(database, stage = "idea") {
  const now = "2026-09-15T01:00:00.000Z";
  database.prepare(`
    INSERT INTO projects (
      id, name, slug, field, goal, language, paper_type, status, stage,
      vault_root, project_path, thread_id, created_at, updated_at
    ) VALUES ('p1', '测试课题', '测试课题', 'AI', '验证状态机', 'zh', 'technical', 'active', ?, '/vault', '/vault/p1', 't1', ?, ?)
  `).run(stage, now, now);
}

function insertRun(database, { id, skillName, adoptedAt = null, startedAt = "2026-09-15T01:00:00.000Z" }) {
  database.prepare(`
    INSERT INTO runs (
      id, project_id, skill_name, thread_id, status, prompt, output,
      artifact_path, adopted_at, started_at, completed_at
    ) VALUES (?, 'p1', ?, 't1', 'completed', 'prompt', 'output', ?, ?, ?, ?)
  `).run(id, skillName, `drafts/${id}.md`, adoptedAt, startedAt, startedAt);
}

describe("阶段 1.5 数据迁移", () => {
  it("为旧数据库补列并把已采用 Idea 幂等迁移为正式版本", () => {
    const database = legacyDatabase();
    insertProject(database, "research");
    insertRun(database, { id: "idea-old", skillName: "idea-evaluator", adoptedAt: "2026-09-15T02:00:00.000Z" });

    migrateStage15(database);
    migrateStage15(database);

    const columns = database.prepare("PRAGMA table_info(runs)").all().map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(["parent_run_id", "cancel_requested_at", "review_status", "reviewed_at", "review_note"]));
    expect(database.prepare("SELECT COUNT(*) AS count FROM stage_versions").get().count).toBe(1);
    expect(database.prepare("SELECT review_status FROM runs WHERE id = 'idea-old'").get().review_status).toBe("adopted");
    expect(database.prepare("SELECT stage, status FROM stage_versions WHERE run_id = 'idea-old'").get()).toMatchObject({ stage: "idea", status: "active" });
    database.close();
  });
});

describe("阶段 1.5 正式版本状态", () => {
  it("采用结果推进阶段、替代旧版本并让下游版本进入复核", () => {
    const database = legacyDatabase();
    insertProject(database, "idea");
    migrateStage15(database);
    const store = createStore(database);

    insertRun(database, { id: "idea-1", skillName: "idea-evaluator" });
    store.activateStageVersion({
      id: randomUUID(), projectId: "p1", stage: "idea", runId: "idea-1",
      skillName: "idea-evaluator", relativePath: "04-idea/versions/idea-v001.md",
      contentSha256: "hash-idea-1",
    });
    expect(store.getProject("p1").stage).toBe("research");
    expect(store.getRun("idea-1").reviewStatus).toBe("adopted");

    insertRun(database, { id: "research-1", skillName: "deep-research", startedAt: "2026-09-15T03:00:00.000Z" });
    store.activateStageVersion({
      id: randomUUID(), projectId: "p1", stage: "research", runId: "research-1",
      skillName: "deep-research", relativePath: "05-research/versions/research-v001.md",
      contentSha256: "hash-research-1",
    });
    expect(store.getProject("p1").stage).toBe("blueprint");

    insertRun(database, { id: "idea-2", skillName: "idea-evaluator", startedAt: "2026-09-15T04:00:00.000Z" });
    const result = store.activateStageVersion({
      id: randomUUID(), projectId: "p1", stage: "idea", runId: "idea-2",
      skillName: "idea-evaluator", relativePath: "04-idea/versions/idea-v002.md",
      contentSha256: "hash-idea-2",
    });

    expect(result.project.stage).toBe("blueprint");
    expect(store.listStageVersions("p1", "idea").map((version) => version.status)).toEqual(["active", "superseded"]);
    expect(store.listStageVersions("p1", "research")[0].status).toBe("needs_review");
    expect(store.getActiveStageVersion("p1", "research")).toBeNull();
    database.close();
  });

  it("记录驳回和要求修改但不创建正式版本", () => {
    const database = legacyDatabase();
    insertProject(database, "research");
    migrateStage15(database);
    const store = createStore(database);
    insertRun(database, { id: "research-reject", skillName: "deep-research" });

    expect(store.reviewRun("research-reject", "reject", "证据不足")).toMatchObject({ reviewStatus: "rejected", reviewNote: "证据不足" });
    expect(store.listStageVersions("p1")).toHaveLength(0);
    database.close();
  });
});

describe("可控删除边界", () => {
  it("允许删除未采用的终态运行，保护已采用和运行中记录", () => {
    const database = legacyDatabase();
    insertProject(database, "research");
    migrateStage15(database);
    migrateStage2(database);
    const store = createStore(database);
    insertRun(database, { id: "failed-run", skillName: "vibe-research-workflow" });
    database.prepare("UPDATE runs SET status = 'failed' WHERE id = 'failed-run'").run();
    expect(store.deleteRun("failed-run").id).toBe("failed-run");
    expect(store.getRun("failed-run")).toBeNull();

    insertRun(database, { id: "running-run", skillName: "vibe-research-workflow" });
    database.prepare("UPDATE runs SET status = 'running' WHERE id = 'running-run'").run();
    expect(() => store.deleteRun("running-run")).toThrow("运行中");

    insertRun(database, { id: "adopted-run", skillName: "idea-evaluator" });
    store.activateStageVersion({ id: "v-adopted", projectId: "p1", stage: "idea", runId: "adopted-run", skillName: "idea-evaluator", relativePath: "04-idea/versions/v001.md" });
    expect(() => store.deleteRun("adopted-run")).toThrow("正式版本");
    database.close();
  });

  it("按依赖顺序清空科研数据，并保留数据库结构", () => {
    const database = legacyDatabase();
    insertProject(database, "research");
    migrateStage15(database);
    migrateStage2(database);
    const store = createStore(database);
    const now = new Date().toISOString();
    const source = store.createSource({ id: "clear-source", projectId: "p1", name: "paper.pdf", kind: "file", relativePath: "02-sources/raw/paper.pdf", sha256: null, size: 3, url: null, status: "raw", createdAt: now });
    store.createEvidenceClaim({ id: "clear-claim", projectId: "p1", sourceId: source.id, claimType: "source_fact", claimText: "claim", locator: "p.1", verificationStatus: "pending", createdAt: now });
    insertRun(database, { id: "clear-run", skillName: "idea-evaluator" });
    database.prepare("UPDATE runs SET status = 'completed' WHERE id = 'clear-run'").run();
    store.activateStageVersion({ id: "clear-version", projectId: "p1", stage: "idea", runId: "clear-run", skillName: "idea-evaluator", relativePath: "04-idea/versions/v001.md" });
    store.createApproval({ id: "clear-approval", projectId: "p1", runId: "clear-run", method: "test", status: "resolved", payload: {}, createdAt: now });
    database.prepare("INSERT INTO feedback (id, project_id, content, status, created_at) VALUES ('clear-feedback', 'p1', 'x', 'open', ?)").run(now);
    store.createProductFeedback({ id: "clear-product-feedback", projectId: "p1", category: "feature", title: "x", details: "x", status: "submitted", createdAt: now });

    const counts = store.clearResearchData();
    expect(counts).toMatchObject({ projects: 1, sources: 1, evidenceClaims: 1, runs: 1, versions: 1, approvals: 1, feedback: 1, productFeedback: 1 });
    expect(store.listProjects()).toHaveLength(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM stage_versions").get().count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM runs").get().count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_feedback").get().count).toBe(0);
    database.close();
  });

  it("来源被证据卡引用时禁止删除", () => {
    const database = legacyDatabase();
    insertProject(database, "research");
    migrateStage15(database);
    migrateStage2(database);
    const store = createStore(database);
    const source = store.createSource({ id: "s1", projectId: "p1", name: "paper.pdf", kind: "file", relativePath: "02-sources/raw/paper.pdf", sha256: null, size: null, url: null, status: "raw", createdAt: new Date().toISOString() });
    const claim = store.createEvidenceClaim({ id: "e1", projectId: "p1", sourceId: source.id, claimType: "source_fact", claimText: "可追溯主张", locator: "p.1", verificationStatus: "pending", createdAt: new Date().toISOString() });
    expect(() => store.deleteSource(source.id)).toThrow("证据卡引用");
    expect(store.deleteEvidenceClaim(claim.id).id).toBe(claim.id);
    expect(store.deleteSource(source.id).id).toBe(source.id);
    database.close();
  });

  it("重启时把已请求取消的悬挂任务恢复为已取消", () => {
    const database = legacyDatabase();
    insertProject(database, "production");
    migrateStage15(database);
    const store = createStore(database);
    insertRun(database, { id: "cancel-stuck", skillName: "drawio-reconstruction" });
    insertRun(database, { id: "run-stuck", skillName: "drawio-reconstruction" });
    database.prepare("UPDATE runs SET status = 'running', completed_at = NULL, cancel_requested_at = ? WHERE id = 'cancel-stuck'").run("2026-09-15T06:00:00.000Z");
    database.prepare("UPDATE runs SET status = 'running', completed_at = NULL WHERE id = 'run-stuck'").run();

    const recovered = store.recoverInterruptedRuns();

    expect(recovered.find((run) => run.id === "cancel-stuck").status).toBe("cancelled");
    expect(recovered.find((run) => run.id === "run-stuck")).toMatchObject({ status: "failed", error: "工作台进程已重启，原运行已中断" });
    database.close();
  });
});
