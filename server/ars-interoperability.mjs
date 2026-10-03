import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { runLedgerRuntime } from "./ars-ledger.mjs";

const CORE_FIELDS = ["origin_skill", "origin_mode", "origin_date", "verification_status", "version_label"];
const KNOWN_EXTENSION_FIELDS = new Set(["literature_corpus", "terminal_policies", "reset_boundary", "inquiry_ledger_ref"]);
const PASSPORT_RESERVED_FIELDS = new Set([
  ...CORE_FIELDS, "integrity_pass_date", "content_hash", "upstream_dependencies", "repro_lock",
  "compliance_history", "reset_boundary", "inquiry_ledger_ref", "literature_corpus", "audit_artifact",
  "slr_lineage", "experiment_intake_declaration", "experiment_provenance", "experiment_alignment_results",
  "terminal_policies", "bibliographic_integrity_signals", "citation_provenance", "citation_verification_summary",
  "claim_audit_results", "claim_drifts", "claim_intent_manifests", "constraint_violations", "human_read_log",
  "rejection_log", "temporal_audit_results", "timeline", "uncited_assertions", "uncited_audit_failures",
  "user_attested_read_resolution", "version_records",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value) {
  return String(value || "passport.json").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "passport.json";
}

function schema9Directory(project) {
  return path.join(project.projectPath, "10-passport", "schema9");
}

function latestReportPath(project) {
  return path.join(schema9Directory(project), "latest-import-report.json");
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function validateCore(document) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { errors: ["顶层必须是 JSON 对象"], warnings };
  }
  for (const field of CORE_FIELDS) {
    if (!(field in document)) errors.push(`缺少 Schema 9 核心字段：${field}`);
  }
  for (const field of ["origin_skill", "origin_mode", "version_label"]) {
    if (field in document && (typeof document[field] !== "string" || !document[field].trim())) errors.push(`${field} 必须是非空字符串`);
  }
  if ("origin_date" in document && (typeof document.origin_date !== "string" || Number.isNaN(Date.parse(document.origin_date)))) {
    errors.push("origin_date 必须是可解析的 ISO 8601 日期时间");
  }
  if ("verification_status" in document && !["VERIFIED", "UNVERIFIED", "STALE"].includes(document.verification_status)) {
    errors.push("verification_status 只能是 VERIFIED、UNVERIFIED 或 STALE");
  }
  if (!("repro_lock" in document)) errors.push("缺少 repro_lock；明确放弃时也必须写为 null");
  if ("content_hash" in document && (typeof document.content_hash !== "string" || !/^[0-9a-f]{64}$/i.test(document.content_hash))) {
    errors.push("content_hash 必须是 64 位 SHA-256 十六进制字符串");
  }
  if ("upstream_dependencies" in document && (!Array.isArray(document.upstream_dependencies) || document.upstream_dependencies.some((item) => typeof item !== "string"))) {
    errors.push("upstream_dependencies 必须是字符串数组");
  }
  const unknown = Object.keys(document).filter((field) => !PASSPORT_RESERVED_FIELDS.has(field));
  if (unknown.length) warnings.push(`发现未纳入本工作台兼容检查的字段：${unknown.join("、")}`);
  const unvalidated = Object.keys(document).filter((field) => PASSPORT_RESERVED_FIELDS.has(field) && !CORE_FIELDS.includes(field) && !KNOWN_EXTENSION_FIELDS.has(field) && !["integrity_pass_date", "content_hash", "upstream_dependencies", "repro_lock"].includes(field));
  if (unvalidated.length) warnings.push(`以下扩展字段只保留原文，未声明通过其专用上游检查：${unvalidated.join("、")}`);
  return { errors, warnings, unvalidatedExtensions: unvalidated };
}

async function runUpstream(scriptName, args) {
  const runtime = runLedgerRuntime();
  const script = path.join(runtime.cwd, "scripts", scriptName);
  if (!(await exists(runtime.python)) || !(await exists(script))) {
    return { status: "unavailable", code: null, stdout: "", stderr: `上游检查器不可用：${scriptName}` };
  }
  const pythonPath = [runtime.dependencyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  const child = spawn(runtime.python, [script, ...args], {
    cwd: runtime.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONPATH: pythonPath },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${scriptName} 检查超时`)); }, 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (value) => { clearTimeout(timer); resolve(value ?? 2); });
  });
  return { status: code === 0 ? "passed" : "failed", code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function importSchema9Passport(project, { fileName, content }) {
  if (typeof content !== "string" || !content.trim()) throw new Error("请选择非空 JSON Passport 文件");
  if (Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) throw new Error("Passport 文件不能超过 5MB");
  let document;
  try { document = JSON.parse(content); }
  catch (error) { throw new Error(`Passport JSON 无法解析：${error.message}`); }

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const directory = path.join(schema9Directory(project), "imports");
  await mkdir(directory, { recursive: true });
  const importedName = `${stamp}-${safeName(fileName)}`;
  const importedPath = path.join(directory, importedName.endsWith(".json") ? importedName : `${importedName}.json`);
  await writeFile(importedPath, content, "utf8");

  const core = validateCore(document);
  const checks = {
    repro_lock: await runUpstream("check_repro_lock.py", [importedPath]),
    literature_corpus: document.literature_corpus === undefined
      ? { status: "not_applicable", code: null, stdout: "", stderr: "Passport 未携带 literature_corpus。" }
      : await runUpstream("check_literature_corpus_schema.py", ["--passport", importedPath]),
  };
  if (checks.repro_lock.status === "failed") core.errors.push(checks.repro_lock.stderr || checks.repro_lock.stdout || "repro_lock 上游检查未通过");
  if (checks.literature_corpus.status === "failed") core.errors.push(checks.literature_corpus.stderr || checks.literature_corpus.stdout || "literature_corpus 上游检查未通过");
  if ([checks.repro_lock, checks.literature_corpus].some((item) => item.status === "unavailable")) {
    core.warnings.push("至少一个上游检查器不可用；不能把本次结果标为完整 Schema 9 验证通过。");
  }
  const report = {
    contract: "ars-workbench-schema9-import-report/1.0",
    imported_at: new Date().toISOString(),
    file_name: path.basename(importedPath),
    imported_relative_path: path.relative(project.projectPath, importedPath).replaceAll("\\", "/"),
    content_sha256: sha256(content),
    status: core.errors.length ? "invalid" : core.warnings.length || core.unvalidatedExtensions?.length ? "core_compatible" : "validated_subset",
    scope: "Schema 9 核心字段 + 已列出的上游子检查器；不是全量 Schema 9 合规证书。",
    errors: core.errors,
    warnings: core.warnings,
    unvalidated_extensions: core.unvalidatedExtensions || [],
    checks,
  };
  await writeJsonAtomic(latestReportPath(project), report);
  return report;
}

export async function readLatestSchema9Report(project) {
  const target = latestReportPath(project);
  if (!(await exists(target))) return null;
  try { return JSON.parse(await readFile(target, "utf8")); }
  catch { return { contract: "ars-workbench-schema9-import-report/1.0", status: "invalid", errors: ["最近一次导入报告无法读取"], warnings: [] }; }
}

export async function readImportedSchema9Passport(project) {
  const report = await readLatestSchema9Report(project);
  if (!report?.imported_relative_path) throw new Error("尚未导入 Schema 9 Passport");
  const target = path.resolve(project.projectPath, report.imported_relative_path);
  const relativeTarget = path.relative(path.resolve(schema9Directory(project)), target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) throw new Error("Schema 9 导入路径越界");
  return { report, target, buffer: await readFile(target) };
}
