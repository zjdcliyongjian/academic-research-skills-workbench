import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { downloadExportFile, listExportFiles, previewExportFile, resolveExportFile } from "../server/export-library.mjs";

const created = [];
afterEach(async () => { while (created.length) await rm(created.pop(), { recursive: true, force: true }); });

async function fixture() {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "research-exports-"));
  created.push(projectPath);
  await mkdir(path.join(projectPath, "11-exports", "markdown"), { recursive: true });
  await mkdir(path.join(projectPath, "11-exports", "word"), { recursive: true });
  await writeFile(path.join(projectPath, "11-exports", "markdown", "research-zh-001.md"), "# 研究方案\n\n可追溯正文", "utf8");
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Word 研究方案</w:t></w:r></w:p><w:p><w:r><w:t>可读正文</w:t></w:r></w:p></w:body></w:document>");
  await writeFile(path.join(projectPath, "11-exports", "word", "research-en-001.docx"), await zip.generateAsync({ type: "nodebuffer" }));
  return { id: "p001", projectPath };
}

describe("导出文件库", () => {
  it("列出真实 Markdown 与 Word 文件并识别语言", async () => {
    const project = await fixture();
    const files = await listExportFiles(project);
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.format).sort()).toEqual(["docx", "markdown"]);
    expect(files.find((file) => file.format === "markdown")?.language).toBe("zh");
    expect(files.find((file) => file.format === "docx")?.language).toBe("en");
    expect(files.every((file) => file.releaseStatus === "legacy")).toBe(true);
  });

  it("预览 Markdown 和提取 Word 正文", async () => {
    const project = await fixture();
    const markdown = await previewExportFile(project, "11-exports/markdown/research-zh-001.md");
    const word = await previewExportFile(project, "11-exports/word/research-en-001.docx");
    expect(markdown.content).toContain("可追溯正文");
    expect(word.content).toContain("Word 研究方案");
    expect(word.note).toContain("最终版式");
  });

  it("下载原文件并拒绝越出当前课题导出目录", async () => {
    const project = await fixture();
    const file = await downloadExportFile(project, "11-exports/markdown/research-zh-001.md");
    expect(file.mime).toContain("text/markdown");
    expect(file.buffer.toString("utf8")).toContain("研究方案");
    expect(() => resolveExportFile(project, "../outside.md")).toThrow("超出科研 Vault 边界");
  });
});
