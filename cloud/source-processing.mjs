import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createCanvas } from "@napi-rs/canvas";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { assertPublicHttpsUrl, safeFileName } from "./security.mjs";
import { extractPdfWithPpStructureV3 } from "../shared/pp-structure-v3.mjs";

// PDF.js uses a fake worker in Node. The explicit worker import prevents a
// runtime-only dynamic import and makes Vercel trace the worker into the
// serverless function bundle.
globalThis.pdfjsWorker = { WorkerMessageHandler };

const MAX_FETCH_BYTES = 12 * 1024 * 1024;
const require = createRequire(import.meta.url);
const ocrLanguageData = {
  chi_sim: require("@tesseract.js-data/chi_sim"),
  eng: require("@tesseract.js-data/eng"),
};

export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function readLimited(response) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > MAX_FETCH_BYTES) throw new Error("网络来源超过 12MB 的演示处理上限");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FETCH_BYTES) { await reader.cancel(); throw new Error("网络来源超过 12MB 的演示处理上限"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchPublicSource(initialUrl) {
  let current = initialUrl;
  for (let i = 0; i < 5; i += 1) {
    await assertPublicHttpsUrl(current, "来源网址");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "AI-Research-Copilot-Cloud/0.4", Accept: "text/html,application/pdf,text/plain;q=0.8" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("来源重定向缺少目标地址");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
    return { buffer: await readLimited(response), mimeType: (response.headers.get("content-type") || "application/octet-stream").split(";")[0], finalUrl: current };
  }
  throw new Error("来源重定向次数过多");
}

function decodeXml(value) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("Word 文件缺少正文结构");
  return decodeXml((await doc.async("string")).replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br(?:\s[^>]*)?\s*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t").replace(/<\/w:tr>/g, "\n").replace(/<\/w:p>/g, "\n\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function meaningfulTextLength(value) {
  return String(value || "").replace(/<!--[^>]*-->/g, "").replace(/[\s\p{P}\p{S}]/gu, "").length;
}

export function sanitizeDatabaseText(value) {
  let result = "";
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0) continue;
    if (character.length === 1 && codePoint >= 0xd800 && codePoint <= 0xdfff) result += "\uFFFD";
    else result += character;
  }
  return result;
}

export function shouldOcrPage(value) {
  return meaningfulTextLength(value) < 20;
}

export function normalizeOcrText(value) {
  return sanitizeDatabaseText(value)
    .replace(/([\p{Script=Han}])[ \t]+(?=[\p{Script=Han}])/gu, "$1")
    .replace(/[ \t]+([，。！？；：、])/g, "$1")
    .replace(/([，。！？；：、])[ \t]+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let ocrDataPromise;
async function prepareOcrData() {
  if (!ocrDataPromise) ocrDataPromise = (async () => {
    const target = join(tmpdir(), "research-workbench-ocr-v1");
    await mkdir(target, { recursive: true });
    for (const code of ["chi_sim", "eng"]) {
      const language = ocrLanguageData[code];
      await copyFile(join(language.langPath, `${code}.traineddata.gz`), join(target, `${code}.traineddata.gz`));
    }
    return target;
  })();
  return ocrDataPromise;
}

async function renderPdfPage(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2400 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(1.35, scale) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer("image/png");
}

async function extractPdfLegacy(buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages = [];
  let worker = null;
  let ocrPages = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
      let usedOcr = false;
      if (shouldOcrPage(text)) {
        if (!worker) worker = await createWorker(["chi_sim", "eng"], 1, {
          langPath: await prepareOcrData(),
          cachePath: join(tmpdir(), "research-workbench-ocr-cache"),
          logger: () => {},
        });
        const result = await worker.recognize(await renderPdfPage(page));
        text = normalizeOcrText(result.data?.text);
        usedOcr = true;
        ocrPages += 1;
      }
      pages.push(`<!-- page:${pageNumber}${usedOcr ? " ocr:true" : ""} -->\n\n${text}`);
    }
  } finally {
    if (worker) await worker.terminate();
    await loadingTask.destroy();
  }
  return { text: pages.join("\n\n"), ocrUsed: ocrPages > 0, ocrPages, pageCount };
}

async function extractPdf(buffer, pdfInput, parserEnv) {
  const structured = await extractPdfWithPpStructureV3(pdfInput, { env: parserEnv || process.env });
  return structured || extractPdfLegacy(buffer);
}

function extractHtml(buffer, url) {
  const dom = new JSDOM(buffer.toString("utf8"), { url });
  const document = dom.window.document;
  const meta = (name) => document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.getAttribute("content")?.trim() || null;
  const metaAll = (name) => [...document.querySelectorAll(`meta[name="${name}"]`)].map((node) => node.getAttribute("content")?.trim()).filter(Boolean);
  const article = new Readability(document.cloneNode(true)).parse();
  return {
    text: (article?.textContent || document.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    title: article?.title || meta("citation_title") || meta("og:title") || document.title || null,
    authors: metaAll("citation_author").length ? metaAll("citation_author") : [meta("author")].filter(Boolean),
    venue: meta("citation_journal_title") || meta("citation_conference_title"),
    year: meta("citation_publication_date")?.match(/(?:19|20)\d{2}/)?.[0] || null,
    doi: meta("citation_doi"),
  };
}

export async function extractBuffer(buffer, mimeType, name, sourceUrl = null, options = {}) {
  const lower = String(name || "").toLowerCase();
  let text = ""; let hints = {}; let ocrUsed = false; let ocrPages = 0;
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const extracted = await extractPdf(buffer, options.pdfInput, options.parserEnv); text = extracted.text; ocrUsed = extracted.ocrUsed; ocrPages = extracted.ocrPages;
  }
  else if (mimeType.includes("wordprocessingml") || lower.endsWith(".docx")) text = await extractDocx(buffer);
  else if (mimeType.includes("html")) { hints = extractHtml(buffer, sourceUrl); text = hints.text; }
  else if (mimeType.startsWith("text/") || /\.(md|txt|csv)$/.test(lower)) text = buffer.toString("utf8");
  else throw new Error(`暂不支持抽取 ${mimeType || "未知类型"}`);
  text = sanitizeDatabaseText(text);
  if (!meaningfulTextLength(text)) throw new Error("没有识别到可读正文；请检查扫描清晰度或文件内容");
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("<!--"));
  const doi = hints.doi || text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[).,;]+$/, "") || null;
  const publicationYear = Number(hints.year || text.match(/\b(?:19|20)\d{2}\b/)?.[0]) || null;
  return {
    text, title: hints.title || (firstLine && firstLine.length <= 260 ? firstLine.replace(/^#+\s*/, "") : safeFileName(name)),
    authors: hints.authors || [], venue: hints.venue || null, doi, publicationYear, ocrUsed, ocrPages,
  };
}
