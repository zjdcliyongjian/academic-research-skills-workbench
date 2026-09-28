import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createProjectSpace } from "../server/vault.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evidenceRoot = path.join(projectRoot, "phase-1.5", "qa-runs", runId);
const dataRoot = path.join(evidenceRoot, "data");
const vaultRoot = path.join(evidenceRoot, "vault");
await mkdir(dataRoot, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("隔离验收服务未能启动");
}

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${data.error || response.status}`);
  return data;
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    AI_RESEARCH_PORT: String(port),
    AI_RESEARCH_DATA_DIR: dataRoot,
    AI_RESEARCH_VAULT_ROOT: vaultRoot,
    AI_RESEARCH_SKIP_CODEX_START: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString("utf8"); });

try {
  const health = await waitForHealth(baseUrl);
  const now = "2026-09-15T02:00:00.000Z";
  const project = {
    id: "qa-stage15-project", name: "阶段1.5隔离验收", slug: "阶段1.5隔离验收",
    field: "AI", goal: "验证人工采用、阶段推进与正式导出边界", language: "zh",
    paperType: "technical", status: "active", stage: "idea", vaultRoot,
    projectPath: "", threadId: "qa-thread", createdAt: now, updatedAt: now,
  };
  project.projectPath = await createProjectSpace(vaultRoot, project);

  const database = new DatabaseSync(path.join(dataRoot, "workbench.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  database.prepare(`
    INSERT INTO projects (id, name, slug, field, goal, language, paper_type, status, stage, vault_root, project_path, thread_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.slug, project.field, project.goal, project.language, project.paperType, project.status, project.stage, project.vaultRoot, project.projectPath, project.threadId, project.createdAt, project.updatedAt);

  const seedRun = (id, skillName, output, startedAt) => database.prepare(`
    INSERT INTO runs (id, project_id, skill_name, thread_id, status, prompt, output, review_status, started_at, completed_at)
    VALUES (?, ?, ?, ?, 'completed', ?, ?, 'pending', ?, ?)
  `).run(id, project.id, skillName, project.threadId, `${skillName} prompt`, output, startedAt, startedAt);

  seedRun("qa-idea-1", "idea-evaluator", "# Idea 第一正式候选", "2026-09-15T02:01:00.000Z");
  seedRun("qa-research-1", "deep-research", "# 调研第一正式候选", "2026-09-15T02:02:00.000Z");
  seedRun("qa-blueprint-1", "tech-paper-template", "# 蓝图第一正式候选", "2026-09-15T02:03:00.000Z");
  seedRun("qa-idea-2", "idea-evaluator", "# Idea 更新版本", "2026-09-15T02:04:00.000Z");
  seedRun("qa-research-reject", "deep-research", "# 应被驳回", "2026-09-15T02:05:00.000Z");
  database.close();

  const idea = await request(baseUrl, "/api/runs/qa-idea-1/reviews", { decision: "adopt", note: "通过隔离验收" });
  const research = await request(baseUrl, "/api/runs/qa-research-1/reviews", { decision: "adopt", note: "通过隔离验收" });
  const blueprint = await request(baseUrl, "/api/runs/qa-blueprint-1/reviews", { decision: "adopt", note: "通过隔离验收" });
  const ideaUpdate = await request(baseUrl, "/api/runs/qa-idea-2/reviews", { decision: "adopt", note: "验证上游更新" });
  const rejected = await request(baseUrl, "/api/runs/qa-research-reject/reviews", { decision: "reject", note: "证据不足" });
  const exported = await request(baseUrl, `/api/projects/${project.id}/exports`, { format: "markdown", language: "zh", mode: "formal" });
  const detail = await request(baseUrl, `/api/projects/${project.id}`);
  const exportBody = await readFile(exported.path, "utf8");

  const assertions = {
    version: health.app.version === "0.3.0-trial",
    ideaAdvancedToResearch: idea.project.stage === "research",
    researchAdvancedToBlueprint: research.project.stage === "blueprint",
    blueprintAdvancedToWriting: blueprint.project.stage === "writing",
    upstreamUpdateDidNotRegress: ideaUpdate.project.stage === "writing",
    downstreamNeedsReview: detail.versions.filter((version) => ["research", "blueprint"].includes(version.stage)).every((version) => version.status === "needs_review"),
    latestIdeaActive: detail.versions.some((version) => version.stage === "idea" && version.versionNumber === 2 && version.status === "active"),
    priorIdeaSuperseded: detail.versions.some((version) => version.stage === "idea" && version.versionNumber === 1 && version.status === "superseded"),
    rejectionRecorded: rejected.run.reviewStatus === "rejected" && rejected.run.reviewNote === "证据不足",
    formalNameMarked: path.basename(exported.path).includes("FORMAL"),
    pendingResearchExcluded: !exportBody.includes("调研第一正式候选") && !exportBody.includes("应被驳回"),
    reviewWarningIncluded: exportBody.includes("已有版本需复核"),
  };
  if (Object.values(assertions).some((value) => !value)) throw new Error(`阶段 1.5 隔离验收失败：${JSON.stringify(assertions)}`);

  const result = {
    passed: true,
    runId,
    port,
    projectId: project.id,
    projectStage: detail.project.stage,
    versions: detail.versions.map(({ stage, versionNumber, status, runId: sourceRunId }) => ({ stage, versionNumber, status, runId: sourceRunId })),
    rejectedReview: { status: rejected.run.reviewStatus, note: rejected.run.reviewNote },
    exportPath: exported.path,
    assertions,
    serverOutput,
  };
  await writeFile(path.join(evidenceRoot, "qa-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  child.kill();
}
