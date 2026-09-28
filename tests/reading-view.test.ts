import { describe, expect, it } from "vitest";
import { parseReadingContent } from "../src/readingView";

describe("extracted reading view", () => {
  it("restores headings, paragraphs, lists and tables", () => {
    const blocks = parseReadingContent([
      "研究方案",
      "",
      "研究背景",
      "这是第一段。",
      "",
      "- 证据一",
      "- 证据二",
      "",
      "实验组\t输入\t指标",
      "A\t图像\t准确率",
    ].join("\n"), "研究方案");
    expect(blocks.map((item) => item.type)).toEqual(["heading", "paragraph", "list", "table"]);
  });

  it("keeps PDF page and OCR markers visible", () => {
    const blocks = parseReadingContent("<!-- page:2 ocr:true -->\n\n扫描正文");
    expect(blocks[0]).toEqual({ type: "page", number: 2, ocr: true });
  });

  it("keeps PP-StructureV3 page markers visible", () => {
    const blocks = parseReadingContent("<!-- page:3 parser:pp-structure-v3 -->\n\n| 指标 | 结果 |\n| --- | --- |\n| 准确率 | 92% |");
    expect(blocks[0]).toEqual({ type: "page", number: 3, ocr: true, parser: "pp-structure-v3" });
    expect(blocks[1]).toEqual({ type: "table", rows: [["指标", "结果"], ["准确率", "92%"]] });
  });
});
