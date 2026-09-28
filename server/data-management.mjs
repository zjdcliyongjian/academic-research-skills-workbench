import { mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DEFAULT_VAULT_ROOT } from "./config.mjs";
import { assertInside, exists, safeSegment } from "./vault.mjs";

function activeRunError() {
  return Object.assign(new Error("当前账号仍有排队中或运行中的任务，请先取消或等待任务结束，再清除数据"), { status: 409 });
}

/**
 * Clear the local research workspace while keeping the account-level runtime
 * and SQLite backups. Project folders are moved into a dated recovery area so
 * an accidental confirmation does not immediately destroy local files.
 */
export async function clearLocalResearchData(store) {
  const projects = store.listProjects();
  const runs = projects.flatMap((project) => store.listRuns(project.id));
  if (runs.some((run) => ["queued", "running", "waiting_approval"].includes(run.status))) throw activeRunError();
  const sources = projects.flatMap((project) => store.listSources(project.id));
  if (sources.some((source) => source.processingStatus === "processing")) throw Object.assign(new Error("当前仍有资料处理任务，请先等待处理结束，再清除数据"), { status: 409 });

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const recoveryRoot = assertInside(DEFAULT_VAULT_ROOT, path.join(DEFAULT_VAULT_ROOT, "99-system", "trash", "cleared-data", `${stamp}-${randomUUID().slice(0, 8)}`));
  const moved = [];
  try {
    for (const project of projects) {
      const source = assertInside(DEFAULT_VAULT_ROOT, project.projectPath);
      if (!(await exists(source))) continue;
      const target = assertInside(recoveryRoot, path.join(recoveryRoot, `${safeSegment(path.basename(source), project.id)}-${randomUUID().slice(0, 8)}`));
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      moved.push({ source, target });
    }
    const counts = store.clearResearchData();
    return {
      cleared: true,
      counts,
      recoveryPath: moved.length ? path.relative(DEFAULT_VAULT_ROOT, recoveryRoot).replaceAll("\\", "/") : null,
      backupsPreserved: true,
    };
  } catch (error) {
    // Restore moved folders when either the file operation or DB transaction
    // fails; the caller can retry without leaving a half-cleared workspace.
    for (const item of moved.reverse()) {
      try { await mkdir(path.dirname(item.source), { recursive: true }); await rename(item.target, item.source); } catch { /* best effort rollback */ }
    }
    throw error;
  }
}
