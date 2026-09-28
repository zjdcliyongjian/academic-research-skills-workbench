import { describe, expect, it } from "vitest";
import { extractBuffer, meaningfulTextLength, normalizeOcrText, sanitizeDatabaseText, shouldOcrPage } from "../cloud/source-processing.mjs";

function createTextPdf(text) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const content = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj",
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

describe("scanned PDF detection", () => {
  it("ignores page markers and punctuation", () => {
    expect(meaningfulTextLength("<!-- page:1 -->\n  ···")).toBe(0);
    expect(shouldOcrPage("<!-- page:1 -->\n  ···")).toBe(true);
  });

  it("keeps pages with meaningful native text", () => {
    expect(shouldOcrPage("This page contains enough searchable academic text.")).toBe(false);
    expect(shouldOcrPage("本页包含足够多的可检索中文学术文本内容。研究方法与结果如下。")) .toBe(false);
  });

  it("removes artificial spaces between Chinese OCR characters", () => {
    expect(normalizeOcrText("课 题 名 称 小 样 本 研 究\n\n\n结 果 ： 需 要 复 核")).toBe("课题名称小样本研究\n\n结果：需要复核");
  });

  it("removes database-invalid Unicode without damaging valid astral text", () => {
    expect(sanitizeDatabaseText("研究\u0000结果\uD800😀")).toBe("研究结果�😀");
  });

  it("extracts a self-contained text PDF with the in-process worker handler", async () => {
    const buffer = createTextPdf("This reproducible research PDF contains searchable native text for verification.");
    const result = await extractBuffer(buffer, "application/pdf", "native-text-fixture.pdf");
    expect(result.text).toContain("<!-- page:1 -->");
    expect(meaningfulTextLength(result.text)).toBeGreaterThan(20);
    expect(result.ocrUsed).toBe(false);
  });
});
