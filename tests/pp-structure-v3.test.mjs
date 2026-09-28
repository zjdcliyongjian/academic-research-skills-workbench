import { describe, expect, it } from "vitest";
import { extractPdfWithPpStructureV3, pdfParserMode, ppStructureV3ResultToMarkdown } from "../shared/pp-structure-v3.mjs";

describe("PP-StructureV3 PDF parser", () => {
  it("selects PP-StructureV3 only when explicitly configured or authenticated", () => {
    expect(pdfParserMode({})).toBe("legacy");
    expect(pdfParserMode({ PADDLEOCR_ACCESS_TOKEN: "token" })).toBe("pp-structure-v3");
    expect(pdfParserMode({ PDF_PARSER: "legacy", PADDLEOCR_ACCESS_TOKEN: "token" })).toBe("legacy");
  });

  it("converts per-page Markdown into the existing page-marker format", () => {
    const parsed = ppStructureV3ResultToMarkdown({ jobId: "job-1", pages: [{ markdownText: "# 标题" }, { markdownText: "| A | B |" }] });
    expect(parsed.text).toContain("<!-- page:1 parser:pp-structure-v3 -->");
    expect(parsed.text).toContain("<!-- page:2 parser:pp-structure-v3 -->");
    expect(parsed.text).toContain("| A | B |");
    expect(parsed.ocrPages).toBe(2);
  });

  it("submits a signed PDF URL with research-document options", async () => {
    let request;
    const client = { parseDocument: async (value) => {
      request = value;
      return { jobId: "job-2", pages: [{ markdownText: "正文" }] };
    } };
    const parsed = await extractPdfWithPpStructureV3({ fileUrl: "https://storage.example/signed.pdf" }, {
      env: { PDF_PARSER: "pp-structure-v3" },
      client,
    });
    expect(request.model).toBe("PP-StructureV3");
    expect(request.fileUrl).toBe("https://storage.example/signed.pdf");
    expect(request.options.useTableRecognition).toBe(true);
    expect(request.options.useFormulaRecognition).toBe(true);
    expect(request.options.returnMarkdownImages).toBe(false);
    expect(parsed.text).toContain("正文");
  });

  it("fails clearly when strict PP-StructureV3 mode has no token", async () => {
    await expect(extractPdfWithPpStructureV3({ fileUrl: "https://storage.example/signed.pdf" }, {
      env: { PDF_PARSER: "pp-structure-v3" },
    })).rejects.toThrow("缺少 PADDLEOCR_ACCESS_TOKEN");
  });
});
