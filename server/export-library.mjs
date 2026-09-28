import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { assertInside, moveToProjectTrash } from "./vault.mjs";

const ALLOWED_EXPORTS = new Set([".md", ".docx", ".bib", ".tex", ".zip"]);
const MIME_TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".bib": "application/x-bibtex; charset=utf-8",
  ".tex": "application/x-tex; charset=utf-8",
  ".zip": "application/zip",
};

function exportRoot(project) {
  return path.join(project.projectPath, "11-exports");
}

function languageFromName(name) {
  if (/(?:^|[-_.])zh(?:[-_.]|$)/i.test(name)) return "zh";
  if (/(?:^|[-_.])en(?:[-_.]|$)/i.test(name)) return "en";
  return "unknown";
}

function fileRecord(project, fullPath, info) {
  const extension = path.extname(fullPath).toLowerCase();
  const name = path.basename(fullPath);
  const releaseStatus = /(?:^|[-_.])DRAFT(?:[-_.]|$)/i.test(name) ? "draft" : /(?:^|[-_.])FORMAL(?:[-_.]|$)/i.test(name) ? "formal" : "legacy";
  return {
    name,
    relativePath: path.relative(project.projectPath, fullPath).replaceAll("\\", "/"),
    format: extension === ".docx" ? "docx" : extension === ".bib" ? "bibtex" : extension === ".tex" ? "latex" : extension === ".zip" ? "package" : "markdown",
    language: languageFromName(path.basename(fullPath)),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    previewKind: extension === ".docx" ? "docx-text" : extension === ".md" ? "markdown" : extension === ".zip" ? "package-manifest" : "plain-text",
    releaseStatus,
  };
}

async function walk(directory, project, results) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, project, results);
    else if (entry.isFile() && ALLOWED_EXPORTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fileRecord(project, fullPath, await stat(fullPath)));
    }
  }
}

export async function listExportFiles(project) {
  const files = [];
  await walk(exportRoot(project), project, files);
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function resolveExportFile(project, relativePath) {
  if (!relativePath || typeof relativePath !== "string") throw new Error("缺少导出文件路径");
  const root = exportRoot(project);
  const target = assertInside(root, path.resolve(project.projectPath, relativePath));
  const extension = path.extname(target).toLowerCase();
  if (!ALLOWED_EXPORTS.has(extension)) throw new Error("该文件格式不支持预览或下载");
  return { target, extension };
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function docxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file("word/document.xml");
  if (!document) throw new Error("Word 文件缺少正文结构，无法预览");
  const xml = await document.async("string");
  return decodeXml(xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br(?:\s[^>]*)?\s*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function previewExportFile(project, relativePath) {
  const { target, extension } = resolveExportFile(project, relativePath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("导出文件不存在");
  if (info.size > 10 * 1024 * 1024) throw new Error("文件超过 10MB，暂不提供在线预览，请直接下载");
  const buffer = await readFile(target);
  const file = fileRecord(project, target, info);
  if (extension === ".zip") {
    const zip = await JSZip.loadAsync(buffer);
    const manifest = zip.file("manifest.json");
    const readme = zip.file("README.md");
    return {
      file,
      kind: "package-manifest",
      content: [readme ? await readme.async("string") : "", manifest ? await manifest.async("string") : ""].filter(Boolean).join("\n\n---\n\n"),
      note: "当前预览显示交付说明与版本清单；压缩包内不包含原始文献、未采用草稿或内部运行日志。",
    };
  }
  return {
    file,
    kind: extension === ".docx" ? "docx-text" : extension === ".md" ? "markdown" : "plain-text",
    content: extension === ".docx" ? await docxText(buffer) : buffer.toString("utf8"),
    note: extension === ".docx" ? "当前为正文内容预览，分页、字体、表格和图形等最终版式以 Word 原文件为准。" : null,
  };
}

export async function downloadExportFile(project, relativePath) {
  const { target, extension } = resolveExportFile(project, relativePath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("导出文件不存在");
  return { name: path.basename(target), mime: MIME_TYPES[extension], buffer: await readFile(target) };
}

export async function deleteExportFile(project, relativePath) {
  const { target } = resolveExportFile(project, relativePath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("导出文件不存在");
  return moveToProjectTrash(project, relativePath, "exports");
}
