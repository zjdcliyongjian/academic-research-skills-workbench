import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { assertInside, safeSegment } from "./vault.mjs";

const BLACK = "000000";
const NAVY = "17365D";
const GRID = "D9D9D9";
const PALE = "F3F6FA";

function text(value, options = {}) {
  return new TextRun({ text: String(value ?? ""), font: "Noto Sans SC", color: BLACK, size: 22, ...options });
}

function paragraph(value, options = {}) {
  return new Paragraph({
    children: [text(value)],
    spacing: { after: 140, line: 340 },
    ...options,
  });
}

function cleanMarkdown(value) {
  return String(value || "").trim()
    .replace(/\[([^\]]+)\]\(<[^>]+>\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\*([^*]+)\*$/, "$1")
    .trim();
}

function splitMarkdownRow(row) {
  const input = row.trim().replace(/^\||\|$/g, "");
  const cells = [];
  let current = "";
  let bracketDepth = 0;
  for (const character of input) {
    if (character === "[") bracketDepth += 1;
    if (character === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (character === "|" && bracketDepth === 0) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function tableWidths(headers) {
  const key = headers.map((item) => item.toLowerCase()).join("|");
  const total = 8360;
  let weights;
  if (/flaw.*severity.*defense/.test(key)) weights = [0.07, 0.37, 0.12, 0.44];
  else if (/dimension.*score.*evidence/.test(key)) weights = [0.15, 0.12, 0.36, 0.37];
  else if (/probe.*yes or no/.test(key)) weights = [0.2, 0.14, 0.66];
  else if (/risk.*level.*mitigation/.test(key)) weights = [0.18, 0.14, 0.68];
  else if (/aspect.*assessment/.test(key)) weights = [0.18, 0.27, 0.55];
  else weights = headers.map(() => 1 / headers.length);
  return weights.map((weight) => Math.round(total * weight));
}

function markdownTable(rows) {
  const headers = rows[0];
  const widths = tableWidths(headers);
  const border = { style: BorderStyle.SINGLE, size: 4, color: GRID };
  const borders = { top: border, bottom: border, left: border, right: border };
  const buildRow = (cells, rowIndex) => new TableRow({
    tableHeader: rowIndex === 0,
    children: cells.map((cell, column) => new TableCell({
      width: { size: widths[column] || Math.round(8360 / cells.length), type: WidthType.DXA },
      shading: { fill: rowIndex === 0 ? NAVY : rowIndex % 2 ? "FFFFFF" : PALE },
      borders,
      margins: { top: 105, bottom: 105, left: 110, right: 110 },
      verticalAlign: "center",
      children: [new Paragraph({
        alignment: column === 0 && cells.length <= 3 ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { line: 250, after: 0 },
        children: [new TextRun({
          text: cleanMarkdown(cell),
          font: "Noto Sans SC",
          size: rowIndex === 0 ? 18 : 17,
          bold: rowIndex === 0,
          color: rowIndex === 0 ? "FFFFFF" : BLACK,
        })],
      })],
    })),
  });
  return new Table({ width: { size: 8360, type: WidthType.DXA }, rows: rows.map(buildRow) });
}

function markdownParagraphs(markdown) {
  const blocks = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.trim().startsWith("|") && lines[index + 1]?.trim().match(/^\|?\s*:?-{3,}/)) {
      const tableRows = [line];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableRows.push(lines[index]);
        index += 1;
      }
      index -= 1;
      const cells = tableRows.map(splitMarkdownRow);
      blocks.push(markdownTable(cells));
      blocks.push(new Paragraph({ spacing: { after: 130 } }));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
      blocks.push(new Paragraph({
        text: cleanMarkdown(heading[2]),
        heading: levels[heading[1].length - 1],
        spacing: { before: 260, after: 120 },
        keepNext: true,
      }));
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push(new Paragraph({
        children: [text(cleanMarkdown(bullet[1]))],
        bullet: { level: 0 },
        spacing: { after: 80, line: 320 },
      }));
      continue;
    }
    const numbered = /^(\d+)\.\s+(.+)$/.exec(line);
    if (numbered) {
      blocks.push(new Paragraph({
        children: [text(`${numbered[1]}. `, { bold: true }), text(cleanMarkdown(numbered[2]))],
        spacing: { after: 100, line: 330 },
        indent: { left: 220, hanging: 220 },
      }));
      continue;
    }
    blocks.push(paragraph(cleanMarkdown(line)));
  }
  return blocks;
}

function sourceTable(sources) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: GRID };
  const cellBorders = { top: border, bottom: border, left: border, right: border };
  const widths = [1200, 3500, 1400, 2260];
  const header = new TableRow({
    tableHeader: true,
    children: ["序号", "资料名称", "类型", "核验状态"].map((label, index) => new TableCell({
      width: { size: widths[index], type: WidthType.DXA },
      shading: { fill: NAVY },
      borders: cellBorders,
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      verticalAlign: "center",
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true, color: "FFFFFF", font: "Noto Sans SC", size: 20 })] })],
    })),
  });
  const rows = sources.map((source, index) => new TableRow({
    children: [String(index + 1), source.name, source.kind === "url" ? "网页" : "文件", source.status].map((value, column) => new TableCell({
      width: { size: widths[column], type: WidthType.DXA },
      shading: { fill: index % 2 ? PALE : "FFFFFF" },
      borders: cellBorders,
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      verticalAlign: "center",
      children: [new Paragraph({ alignment: column === 1 ? AlignmentType.LEFT : AlignmentType.CENTER, children: [text(value, { size: 19 })] })],
    })),
  }));
  return new Table({ width: { size: 8360, type: WidthType.DXA }, rows: [header, ...rows] });
}

function stripFrontmatter(value) {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

const stageLabels = { brief: "研究工作流", idea: "Idea 评估", research: "文献调研", blueprint: "论文蓝图", writing: "章节写作", production: "润色与图表", review: "投稿审查" };

async function selectedContent(project, versions, runs, options = {}) {
  if (options.mode === "draft") {
    const run = options.runId ? runs.find((item) => item.id === options.runId) : runs.find((item) => item.status === "completed");
    if (!run) throw new Error("没有可导出的草稿运行");
    return {
      title: `草稿 ${run.skillName}`,
      body: `> 未经人工采用，不得作为正式研究成果。\n\n${run.output || "该草稿没有正文。"}`,
      provenance: `- 草稿运行：${run.id}\n- Skill：${run.skillName}\n- 审阅状态：${run.reviewStatus || "pending"}`,
      isDraft: true,
    };
  }

  const stageOrder = ["brief", "idea", "research", "blueprint", "writing", "production", "review"];
  const active = versions.filter((version) => version.status === "active");
  if (!active.length) throw new Error("尚无人工采用的正式版本，不能生成正式导出");
  const sections = [];
  const provenance = [];
  for (const stage of stageOrder) {
    const version = active.find((item) => item.stage === stage);
    if (!version) {
      const needsReview = versions.some((item) => item.stage === stage && item.status === "needs_review");
      sections.push(`## ${stageLabels[stage]}\n\n${needsReview ? "现有正式版本因上游版本变化而需要复核，本次正式导出未采用该内容。" : "尚无当前有效的正式版本。"}`);
      provenance.push(`- ${stageLabels[stage]}：${needsReview ? "已有版本需复核，未纳入本次导出" : "尚无正式版本"}`);
      continue;
    }
    const target = assertInside(project.projectPath, path.join(project.projectPath, version.relativePath));
    const body = stripFrontmatter(await readFile(target, "utf8"));
    sections.push(`## ${stageLabels[version.stage] || version.stage} V${String(version.versionNumber).padStart(3, "0")}\n\n${body}`);
    provenance.push(`- ${stageLabels[version.stage] || version.stage}：版本 ${version.id}；运行 ${version.runId}；采用时间 ${version.adoptedAt}；SHA-256 ${version.contentSha256 || "历史版本未记录"}`);
  }
  return { title: "已采用研究成果", body: sections.join("\n\n"), provenance: provenance.join("\n"), isDraft: false };
}

export async function exportMarkdown(project, sources, versions, runs, language = "zh", options = {}) {
  const content = await selectedContent(project, versions, runs, options);
  const draftMark = content.isDraft ? "-DRAFT" : "-FORMAL";
  const name = `${safeSegment(project.name)}-${language}-研究方案${draftMark}-${Date.now()}.md`;
  const target = assertInside(project.projectPath, path.join(project.projectPath, "11-exports", "markdown", name));
  const sourceLines = sources.length
    ? sources.map((source, index) => `${index + 1}. ${source.name} | ${source.kind} | ${source.status} | ${source.relativePath || source.url || ""}`).join("\n")
    : "暂无资料。";
  const draftWarning = content.isDraft ? "\n\n> **草稿警告：未经人工采用，不得作为正式研究成果。**" : "";
  const body = `# ${project.name} 研究方案${content.isDraft ? "（草稿）" : ""}${draftWarning}\n\n## 项目范围\n\n- 领域：${project.field}\n- 论文类型：${project.paperType}\n- 输出语言：${language}\n- 研究目标：${project.goal}\n\n## 证据说明\n\n${content.isDraft ? "本文件是用户主动导出的 AI 草稿。" : "本文件只汇总经过人工采用的当前正式版本。"}\n\n## 版本溯源\n\n${content.provenance}\n\n## 资料台账\n\n${sourceLines}\n\n## ${content.title}\n\n${content.body}\n`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
  return target;
}

export async function exportDocx(project, sources, versions, runs, language = "zh", options = {}) {
  const content = await selectedContent(project, versions, runs, options);
  const draftMark = content.isDraft ? "-DRAFT" : "-FORMAL";
  const name = `${safeSegment(project.name)}-${language}-研究方案${draftMark}-${Date.now()}.docx`;
  const target = assertInside(project.projectPath, path.join(project.projectPath, "11-exports", "word", name));
  const title = language === "en" ? `${project.name} Research Plan${content.isDraft ? " (DRAFT)" : ""}` : `${project.name} 研究方案${content.isDraft ? "（草稿）" : ""}`;
  const children = [
    new Paragraph({ text: title, style: "Title", spacing: { after: 260 } }),
    paragraph(content.isDraft
      ? (language === "en" ? "DRAFT: This AI output has not been adopted by a human and must not be treated as a formal research result." : "草稿警告：本 AI 输出尚未经过人工采用，不得作为正式研究成果。")
      : (language === "en" ? "This document contains only the current versions explicitly adopted through the human review gate." : "本文只汇总经过人工审阅并明确采用的当前正式版本。")),
    new Paragraph({ text: language === "en" ? "Project Scope" : "项目范围", heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 } }),
    paragraph(`${language === "en" ? "Field" : "领域"}：${project.field}`),
    paragraph(`${language === "en" ? "Paper type" : "论文类型"}：${project.paperType}`),
    paragraph(`${language === "en" ? "Goal" : "研究目标"}：${project.goal}`),
    new Paragraph({ text: language === "en" ? "Version Provenance" : "版本溯源", heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 } }),
    ...markdownParagraphs(content.provenance),
    new Paragraph({ text: language === "en" ? "Source Ledger" : "资料台账", heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 }, keepNext: true }),
    ...(sources.length ? [sourceTable(sources)] : [paragraph(language === "en" ? "No sources have been added." : "尚未导入资料。")]),
    new Paragraph({ text: content.title, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }),
    ...markdownParagraphs(content.body),
  ];
  const doc = new Document({
    creator: "AI 科研工作台",
    title,
    description: "可追溯的本地科研工作台导出",
    styles: {
      default: { document: { run: { font: "Noto Sans SC", color: BLACK, size: 22 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Noto Serif SC", bold: true, color: BLACK, size: 40 }, paragraph: { spacing: { after: 260 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Noto Sans SC", bold: true, color: BLACK, size: 29 }, paragraph: { spacing: { before: 260, after: 120 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Noto Sans SC", bold: true, color: BLACK, size: 25 }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Noto Sans SC", bold: true, color: BLACK, size: 23 }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1260, right: 1260 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text("第 ", { size: 18, color: "666666" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666" })] })] }) },
      children,
    }],
  });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await Packer.toBuffer(doc));
  return target;
}
