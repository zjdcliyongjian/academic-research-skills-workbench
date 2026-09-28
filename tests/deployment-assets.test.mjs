import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production document-processing assets", () => {
  it("keeps PDF.js worker and Tesseract runtime assets in the serverless bundle", async () => {
    const source = await readFile(new URL("../cloud/source-processing.mjs", import.meta.url), "utf8");
    const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(source).toContain('from "pdfjs-dist/legacy/build/pdf.worker.mjs"');
    expect(source).toContain('from "../shared/pp-structure-v3.mjs"');
    expect(packageJson.dependencies["@paddleocr/api-sdk"]).toBe("^0.2.3");
    expect(vercel.functions["api/index.mjs"].includeFiles).toBe("node_modules/**/*.{wasm,traineddata.gz}");
  });
});
