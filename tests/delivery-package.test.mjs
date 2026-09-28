import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { exportDeliveryPackage } from "../server/delivery-package.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });

describe("科研交付包", () => {
  it("只收录人工采用版本、已核验来源元数据与正式导出", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "research-package-")); roots.push(root);
    await mkdir(path.join(root, "07-writing", "versions"), { recursive: true });
    await mkdir(path.join(root, "11-exports", "word"), { recursive: true });
    await writeFile(path.join(root, "07-writing", "versions", "writing-v001.md"), "# 正式章节", "utf8");
    await writeFile(path.join(root, "11-exports", "word", "paper-FORMAL.docx"), "formal", "utf8");
    await writeFile(path.join(root, "11-exports", "word", "paper-DRAFT.docx"), "draft", "utf8");
    const project = { id: "p1", name: "可信课题", field: "AI", goal: "test", language: "zh", paperType: "general", stage: "writing", projectPath: root };
    const sources = [
      { id: "s1", status: "content-verified", title: "Verified", authors: [], publicationYear: 2026, venue: "J", doi: "10.1/x", url: null, sha256: "abc" },
      { id: "s2", status: "raw", title: "Raw", authors: [], publicationYear: null },
    ];
    const versions = [{ id: "v1", stage: "writing", versionNumber: 1, status: "active", runId: "r1", skillName: "paper-writer", relativePath: "07-writing/versions/writing-v001.md", contentSha256: "def", adoptedAt: "2026-01-01" }];

    const target = await exportDeliveryPackage(project, sources, versions);
    const zip = await JSZip.loadAsync(await readFile(target));
    expect(Object.keys(zip.files)).toContain("versions/writing-v001.md");
    expect(Object.keys(zip.files)).toContain("exports/paper-FORMAL.docx");
    expect(Object.keys(zip.files)).not.toContain("exports/paper-DRAFT.docx");
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(manifest.verifiedSources.map((item) => item.title)).toEqual(["Verified"]);
    expect(await zip.file("README.md").async("string")).toContain("作者核验");
  });

  it("没有人工采用版本时拒绝生成", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "research-package-")); roots.push(root);
    const project = { name: "空课题", projectPath: root };
    await expect(exportDeliveryPackage(project, [], [])).rejects.toThrow("尚无人工采用的正式版本");
  });
});
