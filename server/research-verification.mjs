import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { access, appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readImportedSchema9Passport } from "./ars-interoperability.mjs";
import { runLedgerRuntime } from "./ars-ledger.mjs";

export const VERIFICATION_AUTHORIZATION_TEXT = "我授权向 Crossref、OpenAlex、Semantic Scholar 和 arXiv 发送当前导入 Passport 的书目元数据进行核验";

function root(project) { return path.join(project.projectPath, "10-passport", "verification"); }
function cachePath(project) { return path.join(root(project), "citation-verification-cache.sqlite"); }
function latestProgrammaticPath(project) { return path.join(root(project), "latest-programmatic-report.json"); }
function pdfIndexPath(project) { return path.join(root(project), "pdf-preflight-index.json"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function exists(target) { try { await access(target); return true; } catch { return false; } }

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function runPython(scriptName, args, env = {}) {
  const runtime = runLedgerRuntime();
  const script = path.join(runtime.cwd, "scripts", scriptName);
  if (!(await exists(runtime.python)) || !(await exists(script))) throw new Error(`上游运行环境不可用：${scriptName}`);
  const pythonPath = [runtime.dependencyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  const child = spawn(runtime.python, [script, ...args], { cwd: runtime.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env, PYTHONPATH: pythonPath } });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${scriptName} 执行超时`)); }, 120_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (value) => { clearTimeout(timer); resolve(value ?? 2); });
  });
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function runPdfPreflight(project, source) {
  if (!source?.relativePath || path.extname(source.relativePath).toLowerCase() !== ".pdf") throw new Error("页码锚点预检只支持项目内已登记的 PDF 原件");
  const input = path.resolve(project.projectPath, source.relativePath);
  const relativeInput = path.relative(path.resolve(project.projectPath), input);
  if (relativeInput.startsWith("..") || path.isAbsolute(relativeInput)) throw new Error("PDF 路径越界");
  if (!(await exists(input))) throw new Error("PDF 原件不存在");
  const directory = path.join(root(project), "pdf-preflight");
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const output = path.join(directory, `${source.id}-${stamp}.json`);
  // The upstream CLI's anchored --output writer intentionally requires POSIX
  // dirfd primitives. Capture stdout and publish atomically here so Windows
  // keeps the exact same structural preflight semantics.
  const result = await runPython("pdf_read_preflight.py", [input]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `PDF preflight 退出码 ${result.code}`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error("PDF preflight 未返回可解析的 JSON sidecar"); }
  await writeJsonAtomic(output, report);
  const index = await readPdfPreflightIndex(project);
  const row = {
    sourceId: source.id,
    sourceName: source.title || source.name,
    verdict: report.verdict,
    reason: report.reason || report.detail || (Array.isArray(report.warnings) && report.warnings.length ? report.warnings.join("；") : null),
    checkedAt: new Date().toISOString(),
    contentSha256: report.sha256 || report.input_sha256 || source.sha256 || null,
    sidecarPath: path.relative(project.projectPath, output).replaceAll("\\", "/"),
    report,
  };
  await writeJsonAtomic(pdfIndexPath(project), { contract: "ars-workbench-pdf-preflight-index/1.0", rows: [row, ...index.rows.filter((item) => item.sourceId !== source.id)] });
  return row;
}

async function readPdfPreflightIndex(project) {
  if (!(await exists(pdfIndexPath(project)))) return { contract: "ars-workbench-pdf-preflight-index/1.0", rows: [] };
  try { return JSON.parse(await readFile(pdfIndexPath(project), "utf8")); } catch { return { contract: "ars-workbench-pdf-preflight-index/1.0", rows: [] }; }
}

function readCacheSummary(project) {
  const target = cachePath(project);
  if (!path.isAbsolute(target)) throw new Error("缓存路径无效");
  try {
    const database = new DatabaseSync(target, { readOnly: true });
    const row = database.prepare("SELECT COUNT(*) AS rows, COUNT(DISTINCT citation_key) AS citations, MIN(verification_timestamp) AS oldest, MAX(verification_timestamp) AS newest FROM verification_cache").get();
    database.close();
    return { status: "ready", path: path.relative(project.projectPath, target).replaceAll("\\", "/"), rows: Number(row.rows || 0), citations: Number(row.citations || 0), oldest: row.oldest || null, newest: row.newest || null, staleAdvisoryDays: Number(process.env.ARS_CACHE_STALE_ADVISORY_DAYS || 30), ttlDays: 90 };
  } catch {
    return { status: "empty", path: path.relative(project.projectPath, target).replaceAll("\\", "/"), rows: 0, citations: 0, oldest: null, newest: null, staleAdvisoryDays: 30, ttlDays: 90 };
  }
}

export async function readVerificationStatus(project) {
  let latestProgrammatic = null;
  if (await exists(latestProgrammaticPath(project))) {
    try { latestProgrammatic = JSON.parse(await readFile(latestProgrammaticPath(project), "utf8")); } catch { latestProgrammatic = { status: "invalid", errors: ["最近一次程序化核验报告无法读取"] }; }
  }
  const pdf = await readPdfPreflightIndex(project);
  return { pdfPreflights: pdf.rows, cache: readCacheSummary(project), latestProgrammatic, authorizationText: VERIFICATION_AUTHORIZATION_TEXT };
}

export async function runProgrammaticCitationVerification(project, input) {
  const authorizationText = String(input.authorizationText || "").trim();
  if (input.authorized !== true || authorizationText !== VERIFICATION_AUTHORIZATION_TEXT) {
    const error = new Error("未记录完整授权文本，程序化引文核验已拒绝"); error.status = 403; throw error;
  }
  const imported = await readImportedSchema9Passport(project);
  if (imported.report.status === "invalid") throw new Error("最近导入的 Schema 9 Passport 未通过核心兼容检查");
  const document = JSON.parse(imported.buffer.toString("utf8"));
  if (!Array.isArray(document.literature_corpus) || document.literature_corpus.length === 0) throw new Error("导入 Passport 没有可核验的 literature_corpus");
  await mkdir(root(project), { recursive: true });
  const authorization = {
    at: new Date().toISOString(),
    provider: "Crossref, OpenAlex, Semantic Scholar, arXiv",
    content_class: "导入 Schema 9 literature_corpus 中的书目元数据",
    passport_sha256: imported.report.content_sha256,
    cached_by_default: true,
    revalidate_stale: input.revalidateStale === true,
    synthetic_ref_slug: "citation_key",
    diagnostic_only: true,
    user_words: authorizationText,
    user_words_sha256: sha256(authorizationText),
  };
  await appendFile(path.join(root(project), "programmatic-verification-authorizations.jsonl"), `${JSON.stringify(authorization)}\n`, "utf8");
  const result = await runPython("verify_passport.py", [imported.target, "--synthetic-ref-slug", "citation_key"], {
    ARS_VERIFICATION_CACHE_PATH: cachePath(project),
    ARS_CACHE_REVALIDATE: input.revalidateStale === true ? "1" : "0",
  });
  let outcomes = null;
  try { outcomes = result.stdout ? JSON.parse(result.stdout) : null; } catch { outcomes = null; }
  const report = {
    contract: "ars-workbench-programmatic-citation-report/1.0",
    status: result.code === 0 && Array.isArray(outcomes) ? "completed" : "failed",
    diagnostic_only: true,
    generated_at: new Date().toISOString(),
    passport_sha256: imported.report.content_sha256,
    authorization,
    outcome_count: Array.isArray(outcomes) ? outcomes.length : 0,
    outcomes,
    stderr: result.stderr,
    boundary: "synthetic ref_slug 仅用于诊断；结果不是真实稿件 prose join，也不能直接作为 Stage 2.5/4.5 PASS。",
  };
  await writeJsonAtomic(latestProgrammaticPath(project), report);
  if (report.status !== "completed") throw new Error(result.stderr || result.stdout || `程序化核验退出码 ${result.code}`);
  return { report, status: await readVerificationStatus(project) };
}
