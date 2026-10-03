import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, ".ars-runtime", "python");
const requirements = path.join(root, "server", "requirements-ars-runtime.txt");
const bundledPython = path.join(
  process.env.USERPROFILE || "",
  ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe",
);
const python = process.env.ARS_PYTHON || (process.platform === "win32" ? bundledPython : "python3");

await mkdir(target, { recursive: true });

const child = spawn(python, ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "--target", target, "-r", requirements], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (value) => resolve(value ?? 1));
});

if (code !== 0) process.exit(code);
console.log(`ARS integration runtime ready: ${target}`);
