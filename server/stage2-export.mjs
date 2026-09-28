import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertInside, safeSegment } from "./vault.mjs";

function bibEscape(value) {
  return String(value || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function citeKey(source, index) {
  const author = source.authors?.[0]?.split(/\s+/).at(-1) || "source";
  const year = source.publicationYear || "nd";
  return `${safeSegment(author, "source").replaceAll("-", "")}${year}${String(index + 1).padStart(2, "0")}`;
}

export async function exportBibtex(project, sources) {
  const eligible = sources.filter((source) => ["metadata-verified", "content-verified"].includes(source.status) && source.title);
  if (!eligible.length) throw new Error("没有已核验且包含题名的来源，不能生成 BibTeX");
  const entries = eligible.map((source, index) => {
    const fields = [
      `  title = {${bibEscape(source.title)}}`,
      source.authors?.length ? `  author = {${source.authors.map(bibEscape).join(" and ")}}` : null,
      source.publicationYear ? `  year = {${source.publicationYear}}` : null,
      source.venue ? `  journal = {${bibEscape(source.venue)}}` : null,
      source.doi ? `  doi = {${bibEscape(source.doi)}}` : null,
      source.url ? `  url = {${source.url}}` : null,
      `  note = {Verified in AI Research Workbench; source_id=${source.id}}`,
    ].filter(Boolean);
    return `@article{${citeKey(source, index)},\n${fields.join(",\n")}\n}`;
  });
  const name = `${safeSegment(project.name)}-citations-FORMAL-${Date.now()}.bib`;
  const target = assertInside(project.projectPath, path.join(project.projectPath, "11-exports", "bibtex", name));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${entries.join("\n\n")}\n`, "utf8");
  return target;
}

function texEscape(value) {
  return String(value || "")
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&").replaceAll("%", "\\%").replaceAll("$", "\\$")
    .replaceAll("#", "\\#").replaceAll("_", "\\_").replaceAll("{", "\\{").replaceAll("}", "\\}")
    .replaceAll("~", "\\textasciitilde{}").replaceAll("^", "\\textasciicircum{}");
}

function stripFrontmatter(value) {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function markdownToTex(value) {
  return stripFrontmatter(value).split(/\r?\n/).map((line) => {
    const h3 = /^###\s+(.+)/.exec(line); if (h3) return `\\subsubsection{${texEscape(h3[1])}}`;
    const h2 = /^##\s+(.+)/.exec(line); if (h2) return `\\subsection{${texEscape(h2[1])}}`;
    const h1 = /^#\s+(.+)/.exec(line); if (h1) return `\\section{${texEscape(h1[1])}}`;
    const bullet = /^[-*]\s+(.+)/.exec(line); if (bullet) return `\\noindent $\\bullet$ ${texEscape(bullet[1])}\\par`;
    return line.trim() ? `${texEscape(line)}\\par` : "";
  }).join("\n");
}

export async function exportLatex(project, versions) {
  const active = versions.filter((version) => version.status === "active");
  if (!active.length) throw new Error("尚无人工采用的正式版本，不能生成 LaTeX");
  const sections = [];
  for (const version of active) {
    const target = assertInside(project.projectPath, path.join(project.projectPath, version.relativePath));
    sections.push(`\\section*{${texEscape(version.stage)} V${String(version.versionNumber).padStart(3, "0")}}\n${markdownToTex(await readFile(target, "utf8"))}`);
  }
  const source = `\\documentclass[UTF8]{ctexart}
\\usepackage[a4paper,margin=2.5cm]{geometry}
\\usepackage{hyperref}
\\title{${texEscape(project.name)}}
\\author{AI 科研工作台辅助整理，最终责任归作者}
\\date{${new Date().toISOString().slice(0, 10)}}
\\begin{document}
\\maketitle
\\section*{证据与版本声明}
本文只装配工作台中人工采用且当前有效的正式版本。引用、实验结果、作者信息和投稿格式仍需作者最终核验。\\par
${sections.join("\n\n")}
\\end{document}
`;
  const name = `${safeSegment(project.name)}-manuscript-FORMAL-${Date.now()}.tex`;
  const target = assertInside(project.projectPath, path.join(project.projectPath, "11-exports", "latex", name));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
  return target;
}
