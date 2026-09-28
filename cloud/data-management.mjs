import { adminClient } from "./repository.mjs";

const BUCKET = "research-files";
const STORAGE_PAGE_SIZE = 1000;
const STORAGE_REMOVE_BATCH_SIZE = 100;

function serviceError(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data || [];
}

function activeRunError(kind = "任务") {
  return Object.assign(new Error(`当前账号仍有排队中或运行中的${kind}，请先取消或等待结束，再清除数据`), { statusCode: 409 });
}

function storageClient() {
  return adminClient().storage.from(BUCKET);
}

/**
 * Supabase Storage does not remove objects when a database row is deleted.
 * Walk the user's private prefix so abandoned signed-upload objects are
 * removed as well as objects referenced by a row.
 */
async function listStorageObjects(prefix) {
  const files = [];
  const visited = new Set();
  const walk = async (folder) => {
    if (visited.has(folder)) return;
    visited.add(folder);
    for (let offset = 0;; offset += STORAGE_PAGE_SIZE) {
      const listed = await storageClient().list(folder, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      const items = serviceError(listed, "无法读取资料存储目录");
      if (!items.length) break;
      for (const item of items) {
        const name = String(item.name || "").trim();
        if (!name) continue;
        const objectPath = folder ? `${folder}/${name}` : name;
        // Storage list returns metadata/id for files and null metadata for
        // directory placeholders. Treat a missing id and metadata as a folder.
        if (item.id || item.metadata) files.push(objectPath);
        else await walk(objectPath);
      }
      if (items.length < STORAGE_PAGE_SIZE) break;
    }
  };
  await walk(prefix);
  return files;
}

async function removeStorageObjects(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  for (let index = 0; index < unique.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const batch = unique.slice(index, index + STORAGE_REMOVE_BATCH_SIZE);
    const result = await storageClient().remove(batch);
    serviceError(result, "无法清理资料存储文件");
  }
  return unique.length;
}

async function selectOwned(table, ownerId, columns) {
  const result = await adminClient().from(table).select(columns).eq("owner_id", ownerId);
  return serviceError(result, `无法读取 ${table} 数据`);
}

async function deleteOwnedRows(table, ownerId) {
  const result = await adminClient().from(table).delete().eq("owner_id", ownerId).select("id");
  return serviceError(result, `无法清理 ${table} 数据`).length;
}

/**
 * Clear research data for one authenticated account.
 *
 * Deliberately excludes profiles/auth.users/model_configs so credentials and
 * the account itself survive. Database rows are deleted after storage cleanup
 * and in dependency order; this avoids orphaned blobs and FK failures.
 */
export async function clearCloudResearchData(ownerId) {
  const [projects, sources, exports, runs] = await Promise.all([
    selectOwned("projects", ownerId, "id"),
    selectOwned("sources", ownerId, "id,blob_url,snapshot_url,processing_status"),
    selectOwned("exports", ownerId, "id,blob_url"),
    selectOwned("runs", ownerId, "id,status"),
  ]);
  if (runs.some((run) => ["queued", "running", "waiting_approval"].includes(run.status))) throw activeRunError();
  if (sources.some((source) => source.processing_status === "processing")) throw activeRunError("资料处理任务");

  // Include unfinalized signed uploads below <ownerId>/, not only DB paths.
  const storageObjects = await listStorageObjects(ownerId);
  const referencedObjects = [
    ...sources.flatMap((source) => [source.blob_url, source.snapshot_url]),
    ...exports.map((item) => item.blob_url),
  ];
  const storageObjectCount = await removeStorageObjects([...storageObjects, ...referencedObjects]);

  const counts = {
    projects: projects.length,
    sources: 0,
    evidenceClaims: 0,
    runs: 0,
    versions: 0,
    exports: 0,
    feedback: 0,
  };
  // Keep this explicit instead of relying on project cascades: it documents
  // the scope and remains safe if a future FK changes its cascade behavior.
  counts.versions = await deleteOwnedRows("stage_versions", ownerId);
  counts.evidenceClaims = await deleteOwnedRows("evidence_claims", ownerId);
  counts.exports = await deleteOwnedRows("exports", ownerId);
  counts.sources = await deleteOwnedRows("sources", ownerId);
  counts.runs = await deleteOwnedRows("runs", ownerId);
  counts.feedback = await deleteOwnedRows("product_feedback", ownerId);
  await deleteOwnedRows("projects", ownerId);

  return { cleared: true, storageObjects: storageObjectCount, counts };
}

export const dataManagementInternals = { listStorageObjects, removeStorageObjects };
