import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";

const DEFAULT_SKILL_ROOT = path.join(os.homedir(), ".codex", "skills", "academic-research-suite");
const DEFAULT_PYTHON = process.platform === "win32"
  ? path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
  : "python3";
const RUNTIME_DEPS = path.join(APP_ROOT, ".ars-runtime", "python");

export function materialPassportPath(project) {
  return path.join(project.projectPath, "10-passport", "material-passport.json");
}

export function runLedgerPath(project) {
  return path.join(project.projectPath, "10-passport", "material-passport_run_ledger.yaml");
}

export function runLedgerRuntime() {
  const skillRoot = path.resolve(process.env.ARS_SKILL_ROOT || DEFAULT_SKILL_ROOT);
  return {
    python: process.env.ARS_PYTHON || DEFAULT_PYTHON,
    script: path.join(skillRoot, "ars", "scripts", "run_ledger.py"),
    cwd: path.join(skillRoot, "ars"),
    dependencyPath: RUNTIME_DEPS,
  };
}

async function isFile(target) {
  try { await access(target); return true; } catch { return false; }
}

async function execute(args, { allowReportItems = false } = {}) {
  const runtime = runLedgerRuntime();
  if (!(await isFile(runtime.script))) {
    const error = new Error(`ARS run ledger 脚本不存在：${runtime.script}`);
    error.code = "ARS_LEDGER_SCRIPT_MISSING";
    throw error;
  }
  if (process.platform === "win32" && !(await isFile(runtime.python))) {
    const error = new Error(`Python 运行时不存在：${runtime.python}`);
    error.code = "ARS_LEDGER_PYTHON_MISSING";
    throw error;
  }
  const pythonPath = [runtime.dependencyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  const child = spawn(runtime.python, [runtime.script, ...args], {
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
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ARS run ledger 命令超时"));
    }, 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (value) => { clearTimeout(timer); resolve(value ?? 2); });
  });
  if (code !== 0 && !(allowReportItems && code === 1)) {
    const error = new Error((stderr || stdout || `ARS run ledger 退出码 ${code}`).trim());
    error.code = "ARS_LEDGER_COMMAND_REFUSED";
    error.exitCode = code;
    throw error;
  }
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

function safeStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export async function recordLedgerDiagnostic(project, operation, error) {
  const directory = path.join(project.projectPath, "10-passport", "ledgers");
  await mkdir(directory, { recursive: true });
  const event = {
    at: new Date().toISOString(),
    operation,
    status: "refused",
    code: error?.code || "ARS_LEDGER_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  await appendFile(path.join(directory, "ledger-diagnostics.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export async function appendRunLedgerEntry(project, entry) {
  const passport = materialPassportPath(project);
  if (!(await isFile(passport))) throw new Error(`Material Passport 不存在：${passport}`);
  const directory = path.join(project.projectPath, "10-passport", "ledgers", "entries");
  await mkdir(directory, { recursive: true });
  const entryPath = path.join(directory, `${safeStamp()}-${entry.kind}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(entryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  const result = await execute(["append", "--passport-path", passport, "--entry-file", entryPath]);
  return { ...JSON.parse(result.stdout), entryPath };
}

export async function readRunLedgerReport(project, claimsPath = null) {
  const args = ["report", "--passport-path", materialPassportPath(project)];
  if (claimsPath) args.push("--claims", claimsPath);
  const result = await execute(args, { allowReportItems: true });
  return JSON.parse(result.stdout);
}

export async function ensureInitialInstructions(project, userWords) {
  const report = await readRunLedgerReport(project);
  if (report.entries > 0) return { alreadyRecorded: true, report };
  const receipt = await appendRunLedgerEntry(project, { kind: "initial_instructions", user_words: userWords });
  return { alreadyRecorded: false, receipt };
}

export async function appendRunCompletionReceipts(project, run) {
  const status = run.status === "completed" ? "passed" : run.status === "failed" ? "failed" : "not_run";
  const outputSha256 = run.output ? createHash("sha256").update(run.output).digest("hex") : undefined;
  const receipt = {
    kind: "tool_receipt",
    step: `codex_run_${run.id}`,
    command: `codex app-server turn/start skill=${run.skillName}`,
    status,
    exit_status: run.status === "completed" ? 0 : run.status === "failed" ? 1 : null,
    retries_used: run.parentRunId ? 1 : 0,
    ...(outputSha256 ? { output_sha256: outputSha256 } : {}),
  };
  const tool = await appendRunLedgerEntry(project, receipt);
  let artifact = null;
  if (run.artifactPath) {
    const ledgerRelativeArtifact = path.relative(
      path.dirname(materialPassportPath(project)),
      path.resolve(project.projectPath, run.artifactPath),
    ).replaceAll("\\", "/");
    artifact = await appendRunLedgerEntry(project, {
      kind: "file_reference",
      path: ledgerRelativeArtifact,
      role: `run_output_${run.skillName}`,
    });
  }
  return { tool, artifact };
}

export async function openRunReviewCheckpoint(project, run) {
  return appendRunLedgerEntry(project, {
    kind: "checkpoint_opened",
    checkpoint_id: `run-review-${run.id}`,
    stage: run.skillName,
    checkpoint_type: ["ars-integrity", "ars-review", "ars-finalize"].includes(run.skillName) ? "MANDATORY" : "FULL",
    question: "是否采用本次运行输出为该阶段的正式版本？",
    options: ["adopt", "reject", "request_revision"],
  });
}

export async function closeRunReviewCheckpoint(project, run, decision, userWords) {
  return appendRunLedgerEntry(project, {
    kind: "checkpoint_closed",
    checkpoint_id: `run-review-${run.id}`,
    answer: decision,
    user_words: userWords,
  });
}

export async function openApprovalCheckpoint(project, approval) {
  return appendRunLedgerEntry(project, {
    kind: "checkpoint_opened",
    checkpoint_id: `tool-approval-${approval.id}`,
    stage: "tool-approval",
    checkpoint_type: "MANDATORY",
    question: approval.reason || "是否允许本次工具操作？",
    options: ["accept", "decline", "cancel"],
  });
}

export async function closeApprovalCheckpoint(project, approval, decision) {
  return appendRunLedgerEntry(project, {
    kind: "checkpoint_closed",
    checkpoint_id: `tool-approval-${approval.id}`,
    answer: decision,
    user_words: decision,
  });
}
