import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_SOURCE_EXTENSIONS, MAX_SOURCE_BYTES } from "./config.mjs";

export function safeSegment(value, fallback = "project") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

export function assertInside(root, target) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("目标路径超出科研 Vault 边界");
  }
  return absoluteTarget;
}

export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function moveToProjectTrash(project, relativePath, category = "items") {
  if (!relativePath) return null;
  const source = assertInside(project.projectPath, path.resolve(project.projectPath, relativePath));
  if (!(await exists(source))) return null;
  const trashDirectory = assertInside(project.projectPath, path.join(project.projectPath, "99-system", "trash", safeSegment(category, "items")));
  await mkdir(trashDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const target = assertInside(trashDirectory, path.join(trashDirectory, `${stamp}-${randomUUID().slice(0, 8)}-${safeSegment(path.basename(source), "item")}`));
  await rename(source, target);
  return path.relative(project.projectPath, target).replaceAll("\\", "/");
}

const TOP_LEVEL_DIRS = [
  "00-工作台入口",
  "01-项目",
  "02-共享方法/研究方法",
  "02-共享方法/写作规范",
  "02-共享方法/图表规范",
  "03-共享来源/人物与机构",
  "03-共享来源/期刊与会议",
  "03-共享来源/数据集与工具",
  "90-模板",
  "98-导出",
  "99-系统/migrations",
];

const PROJECT_DIRS = [
  "01-brief",
  "02-sources/raw",
  "02-sources/extracted",
  "02-sources/web-snapshots",
  "02-sources/metadata",
  "02-sources/evidence-cards",
  "02-sources/citations",
  "03-notes/文献笔记",
  "03-notes/概念笔记",
  "04-idea/drafts",
  "04-idea/versions",
  "05-research/drafts",
  "05-research/versions",
  "06-blueprint/drafts",
  "06-blueprint/versions",
  "07-writing/zh",
  "07-writing/en",
  "07-writing/drafts",
  "07-writing/versions",
  "07-writing/polish",
  "07-writing/manuscript",
  "08-figures/source",
  "08-figures/drawio",
  "08-figures/rendered",
  "08-figures/drafts",
  "08-figures/versions",
  "09-review/pre-submission",
  "09-review/reviewer-comments",
  "09-review/rebuttal",
  "09-review/drafts",
  "09-review/versions",
  "10-feedback",
  "11-exports/markdown",
  "11-exports/word",
  "11-exports/pdf",
  "11-exports/bibtex",
  "11-exports/latex",
  "99-system",
];

export async function initializeVault(vaultRoot) {
  await mkdir(vaultRoot, { recursive: true });
  await Promise.all(TOP_LEVEL_DIRS.map((dir) => mkdir(assertInside(vaultRoot, path.join(vaultRoot, dir)), { recursive: true })));

  const indexPath = path.join(vaultRoot, "00-工作台入口", "index.md");
  if (!(await exists(indexPath))) {
    await writeFile(indexPath, "# AI 科研工作台\n\n> 本 Vault 由本地工作台管理。原始资料只读，AI 输出必须经过人工确认。\n", "utf8");
  }
  return vaultRoot;
}

export async function createProjectSpace(vaultRoot, project) {
  await initializeVault(vaultRoot);
  const folderName = `${project.id}-${safeSegment(project.name)}`;
  const projectPath = assertInside(vaultRoot, path.join(vaultRoot, "01-项目", folderName));
  if (await exists(projectPath)) throw new Error("项目目录已存在，未执行覆盖");
  await Promise.all(PROJECT_DIRS.map((dir) => mkdir(path.join(projectPath, dir), { recursive: true })));

  const now = project.createdAt;
  await writeFile(path.join(projectPath, "00-index.md"), `# ${project.name}\n\n- 项目 ID：\`${project.id}\`\n- 学科/领域：${project.field}\n- 论文类型：${project.paperType}\n- 输出语言：${project.language}\n- 当前阶段：brief\n- 创建时间：${now}\n\n## 研究目标\n\n${project.goal}\n\n## 证据边界\n\n- 原始资料与 AI 输出分层保存。\n- 未核验来源不得写成已确认事实。\n- 关键研究判断、引用采用和正式导出需要人工确认。\n`, "utf8");
  await writeFile(path.join(projectPath, "01-brief", "课题卡.md"), `# 课题卡\n\n## 课题名称\n\n${project.name}\n\n## 领域\n\n${project.field}\n\n## 目标\n\n${project.goal}\n`, "utf8");
  await writeFile(path.join(projectPath, "01-brief", "里程碑.md"), "# 里程碑\n\n- [x] 创建课题\n- [ ] 导入资料\n- [ ] Idea 评估\n- [ ] 文献调研\n- [ ] 论文蓝图\n- [ ] 导出研究方案\n", "utf8");
  await writeFile(path.join(projectPath, "02-sources", "source-ledger.csv"), "source_id,name,kind,path_or_url,sha256,size,status,created_at\n", "utf8");
  await writeFile(path.join(projectPath, "03-notes", "冲突与边界.md"), "# 冲突与边界\n\n记录来源冲突、未核验判断和适用范围。\n", "utf8");
  await writeFile(path.join(projectPath, "04-idea", "approvals.md"), "# Idea 人工确认记录\n", "utf8");
  await writeFile(path.join(projectPath, "04-idea", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "05-research", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "06-blueprint", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "07-writing", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "08-figures", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "09-review", "reviews.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "10-feedback", "advisor-feedback.md"), "# 导师反馈\n", "utf8");
  await writeFile(path.join(projectPath, "99-system", "project.json"), `${JSON.stringify({ ...project, projectPath }, null, 2)}\n`, "utf8");
  await writeFile(path.join(projectPath, "99-system", "codex-threads.json"), `${JSON.stringify({ primary_thread_id: null, stage_threads: {}, desktop_uri_template: "codex://threads/{thread_id}", last_verified_at: null }, null, 2)}\n`, "utf8");
  await writeFile(path.join(projectPath, "99-system", "runs.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "99-system", "approvals.jsonl"), "", "utf8");
  await writeFile(path.join(projectPath, "99-system", "versions.jsonl"), "", "utf8");
  return projectPath;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function saveSourceFile(project, fileName, buffer) {
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("单个资料不能超过 50MB");
  const cleanName = safeSegment(path.basename(fileName), "source");
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_SOURCE_EXTENSIONS.has(extension)) {
    throw new Error(`暂不支持 ${extension || "无扩展名"} 文件`);
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storedName = `${sha256.slice(0, 12)}-${cleanName}${cleanName.toLowerCase().endsWith(extension) ? "" : extension}`;
  const relativePath = path.join("02-sources", "raw", storedName).replaceAll("\\", "/");
  const destination = assertInside(project.projectPath, path.join(project.projectPath, relativePath));
  if (!(await exists(destination))) await writeFile(destination, buffer);
  return { relativePath, sha256, size: buffer.length, storedName };
}

export async function appendSourceLedger(project, source) {
  const ledger = path.join(project.projectPath, "02-sources", "source-ledger.csv");
  const row = [
    source.id, source.name, source.kind, source.relativePath || source.url || "",
    source.sha256 || "", source.size || "", source.status, source.createdAt,
  ].map(csvCell).join(",");
  await appendFile(ledger, `${row}\n`, "utf8");
}

export async function updateCodexBinding(project, threadId) {
  const target = path.join(project.projectPath, "99-system", "codex-threads.json");
  const data = {
    primary_thread_id: threadId,
    stage_threads: {},
    desktop_uri_template: "codex://threads/{thread_id}",
    last_verified_at: new Date().toISOString(),
  };
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function updateProjectProfile(project) {
  const indexPath = assertInside(project.projectPath, path.join(project.projectPath, "00-index.md"));
  const briefPath = assertInside(project.projectPath, path.join(project.projectPath, "01-brief", "课题卡.md"));
  const manifestPath = assertInside(project.projectPath, path.join(project.projectPath, "99-system", "project.json"));
  await writeFile(indexPath, `# ${project.name}\n\n- 项目 ID：\`${project.id}\`\n- 学科/领域：${project.field}\n- 论文类型：${project.paperType}\n- 输出语言：${project.language}\n- 当前阶段：${project.stage}\n- 项目状态：${project.status}\n- 创建时间：${project.createdAt}\n- 更新时间：${project.updatedAt}\n\n## 研究目标\n\n${project.goal}\n\n## 证据边界\n\n- 原始资料与 AI 输出分层保存。\n- 未核验来源不得写成已确认事实。\n- 关键研究判断、引用采用和正式导出需要人工确认。\n`, "utf8");
  await writeFile(briefPath, `# 课题卡\n\n## 课题名称\n\n${project.name}\n\n## 领域\n\n${project.field}\n\n## 论文类型\n\n${project.paperType}\n\n## 输出语言\n\n${project.language}\n\n## 目标\n\n${project.goal}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export async function appendRunEvent(project, event) {
  await appendFile(path.join(project.projectPath, "99-system", "runs.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendApprovalEvent(project, event) {
  await appendFile(path.join(project.projectPath, "99-system", "approvals.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

const STAGE_FOLDERS = {
  brief: "01-brief",
  idea: "04-idea",
  research: "05-research",
  blueprint: "06-blueprint",
  writing: "07-writing",
  production: "08-figures",
  review: "09-review",
};

export async function ensureStage15ProjectLayout(project) {
  for (const folder of Object.values(STAGE_FOLDERS)) {
    await mkdir(path.join(project.projectPath, folder, "drafts"), { recursive: true });
    await mkdir(path.join(project.projectPath, folder, "versions"), { recursive: true });
    const reviews = path.join(project.projectPath, folder, "reviews.jsonl");
    if (!(await exists(reviews))) await writeFile(reviews, "", "utf8");
  }
}

export async function appendStageReview(project, stage, event) {
  const folder = STAGE_FOLDERS[stage];
  if (!folder) throw new Error("未知研究阶段");
  await ensureStage15ProjectLayout(project);
  await appendFile(path.join(project.projectPath, folder, "reviews.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendVersionEvent(project, event) {
  await appendFile(path.join(project.projectPath, "99-system", "versions.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export async function saveRunDraft(project, run) {
  await ensureStage15ProjectLayout(project);
  const stage = ({
    "vibe-research-workflow": "brief", "idea-evaluator": "idea", "deep-research": "research",
    "tech-paper-template": "blueprint", "benchmark-paper-template": "blueprint",
    "intro-drafter": "writing", "paper-writer": "writing", "paper-polish": "production",
    "figure-designer": "production", "drawio-reconstruction": "production",
    "pre-submission-reviewer": "review", "rebuttal-guidance": "review",
  })[run.skillName];
  if (!stage) throw new Error("当前 Skill 尚未配置草稿目录");
  const folder = `${STAGE_FOLDERS[stage]}/drafts`;
  const fileName = `${run.skillName}-${run.id}.md`;
  const target = assertInside(project.projectPath, path.join(project.projectPath, folder, fileName));
  const body = `---\nrun_id: ${run.id}\nthread_id: ${run.threadId}\nturn_id: ${run.turnId || ""}\nskill: ${run.skillName}\nstatus: ${run.status}\ncreated_at: ${run.startedAt}\n---\n\n${run.output}\n`;
  await writeFile(target, body, "utf8");
  return path.relative(project.projectPath, target).replaceAll("\\", "/");
}

export async function saveStageVersion(project, run, stage, versionNumber, adoptedAt = new Date().toISOString()) {
  const folder = STAGE_FOLDERS[stage];
  if (!folder) throw new Error("未知研究阶段");
  await ensureStage15ProjectLayout(project);
  const version = `v${String(versionNumber).padStart(3, "0")}`;
  const date = adoptedAt.slice(0, 10).replaceAll("-", "");
  const fileName = `${stage}-${version}-${date}-${run.id.slice(0, 8)}.md`;
  const relativePath = path.join(folder, "versions", fileName).replaceAll("\\", "/");
  const target = assertInside(project.projectPath, path.join(project.projectPath, relativePath));
  const contentSha256 = createHash("sha256").update(run.output || "").digest("hex");
  const body = `---\nstage: ${stage}\nversion: ${versionNumber}\nstatus: active\nrun_id: ${run.id}\nskill: ${run.skillName}\nadopted_at: ${adoptedAt}\ncontent_sha256: ${contentSha256}\n---\n\n${run.output || ""}\n`;
  await writeFile(target, body, "utf8");
  return { relativePath, contentSha256, adoptedAt };
}

export async function adoptIdeaEvaluation(project, run) {
  if (run.skillName !== "idea-evaluator") throw new Error("当前结果不是 Idea 评估");
  const versionLine = (await readFile(path.join(project.projectPath, "04-idea", "approvals.md"), "utf8")).split("\n").filter((line) => line.startsWith("- ")).length + 1;
  const fileName = `evaluation-v${String(versionLine).padStart(3, "0")}.md`;
  const target = path.join(project.projectPath, "04-idea", fileName);
  await writeFile(target, `${run.output}\n`, "utf8");
  const adoptedAt = new Date().toISOString();
  await appendFile(path.join(project.projectPath, "04-idea", "approvals.md"), `\n- ${adoptedAt}：采用运行 \`${run.id}\`，保存为 \`${fileName}\`。\n`, "utf8");
  await appendFile(path.join(project.projectPath, "99-system", "versions.jsonl"), `${JSON.stringify({ type: "idea-evaluation", run_id: run.id, version: fileName, adopted_at: adoptedAt })}\n`, "utf8");
  return { artifactPath: path.relative(project.projectPath, target).replaceAll("\\", "/"), adoptedAt };
}

export function createSourceId() {
  return randomUUID();
}
