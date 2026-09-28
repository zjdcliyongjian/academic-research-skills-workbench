import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportBibtex, exportLatex } from "../server/stage2-export.mjs";
import { processSource, quoteHash } from "../server/source-processing.mjs";
import { stageForSkill } from "../server/research-state.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const qaRoot = path.join(root, "qa-runs", stamp);
const projectPath = path.join(qaRoot, "vault", "01-项目", "stage2-isolated");
await mkdir(path.join(projectPath, "02-sources", "raw"), { recursive: true });
await mkdir(path.join(projectPath, "07-writing", "versions"), { recursive: true });

const assertions = [];
function check(name, condition, evidence) {
  if (!condition) throw new Error(`QA 失败：${name}`);
  assertions.push({ name, pass: true, evidence });
}

const project = { name: "阶段2隔离验收", projectPath };
const mdPath = path.join(projectPath, "02-sources", "raw", "paper.md");
await writeFile(mdPath, "# Evidence Paper 2025\n\nDOI 10.1234/stage2.qa\n\nThis is isolated evidence.", "utf8");
const mdResult = await processSource(project, { id: "qa-md", kind: "file", name: "paper.md", relativePath: "02-sources/raw/paper.md", snapshotPath: null });
check("Markdown 正文抽取", Boolean(mdResult.extractedPath), mdResult.extractedPath);
check("DOI 候选识别", mdResult.doi === "10.1234/stage2.qa", mdResult.doi);
check("年份候选识别", mdResult.publicationYear === 2025, mdResult.publicationYear);

const webResult = await processSource(project, { id: "qa-web", kind: "url", name: "example.com", url: "https://example.com/", snapshotPath: null });
check("公开网页快照", Boolean(webResult.snapshotPath), webResult.snapshotPath);
check("网页正文抽取", Boolean(webResult.extractedPath), webResult.extractedPath);

const samplePdf = path.resolve(root, "..", "phase-1", "qa-render-final", "word-export.pdf");
const qaPdf = path.join(projectPath, "02-sources", "raw", "sample.pdf");
await copyFile(samplePdf, qaPdf);
const pdfResult = await processSource(project, { id: "qa-pdf", kind: "file", name: "sample.pdf", relativePath: "02-sources/raw/sample.pdf", snapshotPath: null });
const pdfText = await readFile(path.join(projectPath, pdfResult.extractedPath), "utf8");
check("真实 PDF 正文抽取", pdfText.includes("<!-- page:1 -->"), pdfResult.extractedPath);

check("证据短引文哈希", quoteHash("traceable quote").length === 64, quoteHash("traceable quote"));
check("写作 Skill 状态映射", stageForSkill("paper-writer") === "writing", stageForSkill("paper-writer"));
check("生产 Skill 状态映射", stageForSkill("figure-designer") === "production", stageForSkill("figure-designer"));
check("审查 Skill 状态映射", stageForSkill("pre-submission-reviewer") === "review", stageForSkill("pre-submission-reviewer"));

const versionPath = path.join(projectPath, "07-writing", "versions", "writing-v001.md");
await writeFile(versionPath, "---\nstage: writing\n---\n\n# Introduction\n\nOnly adopted content is assembled.", "utf8");
const versions = [{ stage: "writing", versionNumber: 1, status: "active", relativePath: "07-writing/versions/writing-v001.md" }];
const bibPath = await exportBibtex(project, [{ id: "qa-md", status: "content-verified", title: mdResult.title, authors: ["QA Author"], publicationYear: mdResult.publicationYear, doi: mdResult.doi, url: null }]);
const texPath = await exportLatex(project, versions);
check("BibTeX 正式导出", (await readFile(bibPath, "utf8")).includes("10.1234/stage2.qa"), path.relative(projectPath, bibPath));
check("LaTeX 正式装配", (await readFile(texPath, "utf8")).includes("Only adopted content"), path.relative(projectPath, texPath));

const result = {
  version: "0.3.0-trial",
  createdAt: new Date().toISOString(),
  isolatedProjectPath: projectPath,
  assertions,
  summary: { passed: assertions.length, failed: 0 },
};
await mkdir(qaRoot, { recursive: true });
await writeFile(path.join(qaRoot, "qa-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
