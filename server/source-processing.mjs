import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { assertInside, safeSegment } from "./vault.mjs";
import { extractPdfWithPpStructureV3 } from "../shared/pp-structure-v3.mjs";

const MAX_FETCH_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function assertPublicUrl(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("只支持 HTTP 或 HTTPS 地址");
  if (parsed.username || parsed.password) throw new Error("网址不能包含用户名或密码");
  const allowedPort = !parsed.port || (parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443");
  if (!allowedPort) throw new Error("为降低内网访问风险，仅支持标准 HTTP/HTTPS 端口");
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("该地址解析到本机、私网或保留地址，已拒绝访问");
  return parsed;
}

async function readLimitedResponse(response) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > MAX_FETCH_BYTES) throw new Error("网络来源超过 20MB 上限");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error("网络来源超过 20MB 上限");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchPublic(url) {
  let current = url;
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "AI-Research-Copilot-Workbench/0.2 (+local evidence capture)", Accept: "text/html,application/pdf,text/plain;q=0.8" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("来源返回重定向但缺少目标地址");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
    const mimeType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const buffer = await readLimitedResponse(response);
    return { buffer, mimeType, finalUrl: current };
  }
  throw new Error("来源重定向次数超过 5 次");
}

function decodeXml(value) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file("word/document.xml");
  if (!document) throw new Error("Word 文件缺少正文结构");
  return decodeXml((await document.async("string"))
    .replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br(?:\s[^>]*)?\s*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t").replace(/<\/w:tr>/g, "\n").replace(/<\/w:p>/g, "\n\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdfLegacy(buffer) {
  const document = await getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
    pages.push(`<!-- page:${pageNumber} -->\n\n${text}`);
  }
  return pages.join("\n\n");
}

async function extractPdf(buffer, pdfInput) {
  const structured = await extractPdfWithPpStructureV3(pdfInput);
  return structured?.text || extractPdfLegacy(buffer);
}

function extractHtml(html, url) {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const meta = (name) => document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.getAttribute("content")?.trim() || null;
  const metaAll = (name) => [...document.querySelectorAll(`meta[name="${name}"]`)].map((node) => node.getAttribute("content")?.trim()).filter(Boolean);
  const article = new Readability(document.cloneNode(true)).parse();
  const text = (article?.textContent || document.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text,
    title: article?.title || meta("citation_title") || meta("og:title") || document.title || null,
    authors: metaAll("citation_author").length ? metaAll("citation_author") : [meta("author")].filter(Boolean),
    venue: meta("citation_journal_title") || meta("citation_conference_title"),
    year: meta("citation_publication_date")?.match(/(?:19|20)\d{2}/)?.[0] || null,
    doi: meta("citation_doi") || null,
  };
}

function inferMetadata(text, fallbackTitle, hints = {}) {
  const doi = hints.doi || text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[).,;]+$/, "") || null;
  const year = Number(hints.year || text.match(/\b(?:19|20)\d{2}\b/)?.[0]) || null;
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("<!--"));
  return {
    title: hints.title || (firstLine && firstLine.length <= 260 ? firstLine.replace(/^#+\s*/, "") : fallbackTitle),
    authors: hints.authors || [],
    publicationYear: year,
    venue: hints.venue || null,
    doi,
  };
}

export async function processSource(project, source) {
  const stamp = new Date().toISOString();
  let buffer;
  let mimeType;
  let snapshotPath = source.snapshotPath || null;
  let extractionHints = {};
  let fallbackTitle = source.name;
  let pdfInput;

  if (source.kind === "url") {
    const fetched = await fetchPublic(source.url);
    buffer = fetched.buffer;
    mimeType = fetched.mimeType;
    const extension = mimeType === "application/pdf" ? ".pdf" : mimeType.includes("html") ? ".html" : ".txt";
    snapshotPath = path.join("02-sources", "web-snapshots", `${source.id}${extension}`).replaceAll("\\", "/");
    await mkdir(path.dirname(path.join(project.projectPath, snapshotPath)), { recursive: true });
    await writeFile(assertInside(project.projectPath, path.join(project.projectPath, snapshotPath)), buffer);
    fallbackTitle = new URL(fetched.finalUrl).hostname + new URL(fetched.finalUrl).pathname;
    pdfInput = { fileUrl: fetched.finalUrl };
  } else {
    if (!source.relativePath) throw new Error("来源缺少原始文件路径");
    const sourcePath = assertInside(project.projectPath, path.join(project.projectPath, source.relativePath));
    buffer = await readFile(sourcePath);
    pdfInput = { filePath: sourcePath };
    const extension = path.extname(source.relativePath).toLowerCase();
    mimeType = extension === ".pdf" ? "application/pdf" : extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain";
  }

  let text;
  if (mimeType === "application/pdf" || path.extname(source.relativePath || "").toLowerCase() === ".pdf") text = await extractPdf(buffer, pdfInput);
  else if (mimeType.includes("wordprocessingml") || path.extname(source.relativePath || "").toLowerCase() === ".docx") text = await extractDocx(buffer);
  else if (mimeType.includes("html")) {
    const parsed = extractHtml(buffer.toString("utf8"), source.url);
    text = parsed.text;
    extractionHints = parsed;
  } else if (mimeType.startsWith("text/") || [".md", ".txt", ".csv"].includes(path.extname(source.relativePath || "").toLowerCase())) text = buffer.toString("utf8");
  else throw new Error(`暂不支持抽取 ${mimeType || "未知类型"}`);

  if (!text.trim()) throw new Error("没有抽取到可读正文；扫描 PDF 需要后续 OCR 能力");
  const metadata = inferMetadata(text, fallbackTitle, extractionHints);
  const baseName = `${source.id}-${safeSegment(metadata.title || source.name, "source")}`;
  const extractedPath = path.join("02-sources", "extracted", `${baseName}.md`).replaceAll("\\", "/");
  const metadataPath = path.join("02-sources", "metadata", `${source.id}.json`).replaceAll("\\", "/");
  await mkdir(path.dirname(path.join(project.projectPath, extractedPath)), { recursive: true });
  await mkdir(path.dirname(path.join(project.projectPath, metadataPath)), { recursive: true });
  const header = `---\nsource_id: ${source.id}\nsource_sha256: ${sha256(buffer)}\nprocessed_at: ${stamp}\nmime_type: ${mimeType}\n---\n\n`;
  await writeFile(assertInside(project.projectPath, path.join(project.projectPath, extractedPath)), header + text, "utf8");
  await writeFile(assertInside(project.projectPath, path.join(project.projectPath, metadataPath)), `${JSON.stringify({ ...metadata, sourceId: source.id, mimeType, snapshotPath, extractedPath, processedAt: stamp, extraction: "automatic-unverified" }, null, 2)}\n`, "utf8");
  return { ...metadata, mimeType, snapshotPath, extractedPath, sha256: sha256(buffer), size: buffer.length, processedAt: stamp, processingStatus: "metadata_pending", status: "raw" };
}

export async function previewSource(project, source) {
  if (!source.extractedPath) throw new Error("该来源尚未生成抽取正文");
  const target = assertInside(project.projectPath, path.join(project.projectPath, source.extractedPath));
  const body = await readFile(target, "utf8");
  const content = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const ppStructure = content.includes("parser:pp-structure-v3");
  return { source, content, note: ppStructure ? "这是 PP-StructureV3 生成的结构化 Markdown；阅读顺序、公式和表格仍需逐页对照原件核验。" : "这是自动抽取的纯文本预览；版式、公式、表格和图片仍以原始文件或快照为准。" };
}

export async function downloadSource(project, source, requestedKind = "original") {
  const kind = ["original", "snapshot", "extracted"].includes(requestedKind) ? requestedKind : "original";
  const relativePath = kind === "extracted"
    ? source.extractedPath
    : kind === "snapshot"
      ? source.snapshotPath
      : source.kind === "file" ? source.relativePath : source.snapshotPath;
  if (!relativePath) {
    throw new Error(kind === "original" && source.kind === "url" ? "该网页尚未处理，暂时没有可下载的网页快照" : "该来源尚未生成对应文件");
  }
  const target = assertInside(project.projectPath, path.join(project.projectPath, relativePath));
  const buffer = await readFile(target);
  const extension = path.extname(target).toLowerCase();
  const mime = ({
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  })[extension] || "application/octet-stream";
  return { name: path.basename(target), mime, buffer, relativePath };
}

export function quoteHash(value) {
  return value ? sha256(Buffer.from(value, "utf8")) : null;
}
