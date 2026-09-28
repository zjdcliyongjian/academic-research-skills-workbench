import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/repository.mjs", () => ({ adminClient: vi.fn() }));

import { adminClient } from "../cloud/repository.mjs";
import { clearCloudResearchData } from "../cloud/data-management.mjs";

function queryResult(data, deleted = false) {
  const chain = {
    mode: deleted ? "delete" : "select",
    select() { return chain; },
    eq() { return chain; },
    delete() { chain.mode = "delete"; return chain; },
    then(resolve, reject) {
      try { resolve({ data: chain.mode === "delete" ? [{ id: "deleted" }] : data, error: null }); }
      catch (error) { reject?.(error); }
    },
  };
  return chain;
}

describe("云端科研数据清理", () => {
  let deletedTables;
  let removedObjects;
  let storageList;
  beforeEach(() => {
    deletedTables = [];
    removedObjects = [];
    storageList = vi.fn(async (prefix) => {
      if (prefix === "owner-1") return { data: [{ name: "project-1", id: null, metadata: null }], error: null };
      if (prefix === "owner-1/project-1") return { data: [{ name: "orphan.bin", id: "orphan", metadata: { size: 3 } }], error: null };
      return { data: [], error: null };
    });
    const rows = {
      projects: [{ id: "project-1" }],
      sources: [{ id: "source-1", blob_url: "owner-1/project-1/sources/source-1/file.pdf", snapshot_url: null, processing_status: "registered" }],
      exports: [{ id: "export-1", blob_url: "owner-1/project-1/exports/export.zip" }],
      runs: [{ id: "run-1", status: "completed" }],
    };
    const from = (table) => {
      if (table === "research-files") return { list: storageList, remove: vi.fn(async (items) => { removedObjects.push(...items); return { data: items, error: null }; }) };
      return {
        select: () => queryResult(rows[table] || []),
        delete: () => { deletedTables.push(table); return queryResult([], true); },
      };
    };
    adminClient.mockReturnValue({ from, storage: { from } });
  });

  it("先清理用户前缀文件，再按依赖顺序删除科研表，保留模型配置", async () => {
    const result = await clearCloudResearchData("owner-1");
    expect(result.cleared).toBe(true);
    expect(removedObjects).toEqual(expect.arrayContaining([
      "owner-1/project-1/orphan.bin",
      "owner-1/project-1/sources/source-1/file.pdf",
      "owner-1/project-1/exports/export.zip",
    ]));
    expect(deletedTables).toEqual(["stage_versions", "evidence_claims", "exports", "sources", "runs", "product_feedback", "projects"]);
    expect(deletedTables).not.toContain("model_configs");
  });

  it("有活动运行时拒绝清理，避免延迟任务写回已删除记录", async () => {
    const from = () => ({ select: () => queryResult([{ id: "run-1", status: "running" }]) });
    adminClient.mockReturnValue({ from, storage: { from } });
    await expect(clearCloudResearchData("owner-1")).rejects.toThrow("运行中");
    expect(deletedTables).toHaveLength(0);
  });
});
