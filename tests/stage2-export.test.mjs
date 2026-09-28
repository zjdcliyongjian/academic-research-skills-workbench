import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportBibtex, exportLatex } from "../server/stage2-export.mjs";
import { deleteExportFile } from "../server/export-library.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });

describe("阶段 2D 引用与整稿导出", () => {
  it("只把已核验来源写入 BibTeX", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stage2-export-")); roots.push(root);
    const project = { name: "可信交付", projectPath: root };
    const sources = [
      { id: "s1", status: "content-verified", title: "Verified Paper", authors: ["Ada Lovelace"], publicationYear: 2025, venue: "Test Journal", doi: "10.1234/test", url: "https://example.org/paper" },
      { id: "s2", status: "raw", title: "Unverified Paper", authors: [], publicationYear: null },
    ];
    const target = await exportBibtex(project, sources);
    const body = await readFile(target, "utf8");
    expect(body).toContain("Verified Paper");
    expect(body).not.toContain("Unverified Paper");
    expect(body).toContain("10.1234/test");
  });

  it("LaTeX 只装配当前有效正式版本", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stage2-export-")); roots.push(root);
    const project = { name: "整稿装配", projectPath: root };
    await mkdir(path.join(root, "07-writing", "versions"), { recursive: true });
    await writeFile(path.join(root, "07-writing", "versions", "writing-v001.md"), "---\nstage: writing\n---\n\n# Introduction\n\nVerified content.", "utf8");
    const versions = [{ stage: "writing", versionNumber: 1, status: "active", relativePath: "07-writing/versions/writing-v001.md" }];
    const target = await exportLatex(project, versions);
    const body = await readFile(target, "utf8");
    expect(body).toContain("\\documentclass");
    expect(body).toContain("Verified content");
    expect(body).toContain("writing V001");
  });

  it("删除导出文件时移入项目回收区而不是永久清除", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stage2-export-")); roots.push(root);
    const project = { name: "可恢复删除", projectPath: root };
    const relativePath = "11-exports/markdown/research.md";
    await mkdir(path.join(root, "11-exports", "markdown"), { recursive: true });
    await writeFile(path.join(root, relativePath), "recoverable", "utf8");

    const trashPath = await deleteExportFile(project, relativePath);

    await expect(readFile(path.join(root, relativePath), "utf8")).rejects.toThrow();
    expect(trashPath).toMatch(/^99-system\/trash\/exports\//);
    expect(await readFile(path.join(root, trashPath), "utf8")).toBe("recoverable");
  });
});
