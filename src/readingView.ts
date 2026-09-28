export type ReadingBlock =
  | { type: "page"; number: number; ocr: boolean; parser?: "pp-structure-v3" }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][] };

const knownHeadings = /^(摘要|关键词|引言|研究背景|研究问题|研究目标|研究假设|假设|相关工作|研究方法|实验设计|数据与评估计划|实验结果|结果|讨论|局限性|结论|预期输出|参考文献|证据边界)$/;

function normalizedTitle(value: string) {
  return value.replace(/^#+\s*/, "").replace(/\s+/g, "").trim();
}

function nextContentLine(lines: string[], from: number) {
  for (let index = from; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (value) return value;
  }
  return "";
}

function looksLikeHeading(line: string, nextLine: string) {
  if (knownHeadings.test(line)) return true;
  if (!nextLine || line.length > 26) return false;
  if (/[。！？；：,.!?]$/.test(line) || /\t/.test(line)) return false;
  if (/^(第\s*\d+\s*页|https?:\/\/|DOI\b)/i.test(line)) return false;
  return nextLine.length >= Math.max(18, line.length + 5);
}

export function parseReadingContent(content: string, title = ""): ReadingBlock[] {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReadingBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let tableRows: string[][] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").replace(/[ \t]+/g, " ").trim();
    if (text && normalizedTitle(text) !== normalizedTitle(title)) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushTable = () => {
    if (tableRows.length) blocks.push({ type: "table", rows: tableRows });
    tableRows = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushTable(); };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) { flushAll(); continue; }

    const page = line.match(/^<!--\s*page:(\d+)((?:\s+[a-z0-9_-]+:[^\s>]+)*)\s*-->$/i);
    if (page) {
      flushAll();
      const ppStructure = /(?:^|\s)parser:pp-structure-v3(?:\s|$)/i.test(page[2]);
      blocks.push({ type: "page", number: Number(page[1]), ocr: ppStructure || /(?:^|\s)ocr:true(?:\s|$)/i.test(page[2]), ...(ppStructure ? { parser: "pp-structure-v3" as const } : {}) });
      continue;
    }

    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      flushAll();
      const text = markdownHeading[2].trim();
      if (normalizedTitle(text) !== normalizedTitle(title)) blocks.push({ type: "heading", level: markdownHeading[1].length <= 2 ? 2 : 3, text });
      continue;
    }

    const markdownTableRow = /^\|.*\|$/.test(line) ? line.slice(1, -1).split("|").map((cell) => cell.trim()) : null;
    if (markdownTableRow && markdownTableRow.length > 1) {
      flushParagraph(); flushList();
      if (!markdownTableRow.every((cell) => /^:?-{3,}:?$/.test(cell))) tableRows.push(markdownTableRow);
      continue;
    }

    if (line.includes("\t")) {
      flushParagraph(); flushList();
      tableRows.push(line.split("\t").map((cell) => cell.trim()).filter(Boolean));
      continue;
    }

    const listItem = line.match(/^([-*•]|\d+[.)、])\s*(.+)$/);
    if (listItem) {
      flushParagraph(); flushTable();
      const ordered = /^\d/.test(listItem[1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(listItem[2].trim());
      continue;
    }

    if (looksLikeHeading(line, nextContentLine(lines, index + 1))) {
      flushAll();
      if (normalizedTitle(line) !== normalizedTitle(title)) blocks.push({ type: "heading", level: knownHeadings.test(line) ? 2 : 3, text: line });
      continue;
    }

    flushList(); flushTable();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}
