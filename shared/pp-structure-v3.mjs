import { Model, PaddleOCRClient } from "@paddleocr/api-sdk";

const PP_STRUCTURE_V3 = "pp-structure-v3";
const LEGACY = "legacy";

export function pdfParserMode(env = process.env) {
  const configured = String(env.PDF_PARSER || "auto").trim().toLowerCase();
  if (configured === "auto") return env.PADDLEOCR_ACCESS_TOKEN ? PP_STRUCTURE_V3 : LEGACY;
  if (![PP_STRUCTURE_V3, LEGACY].includes(configured)) throw new Error("PDF_PARSER 仅支持 pp-structure-v3、legacy 或 auto");
  return configured;
}

export function ppStructureV3ResultToMarkdown(result) {
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  if (!pages.length) throw new Error("PP-StructureV3 未返回任何页面");
  const text = pages.map((page, index) => {
    const markdown = String(page?.markdownText || "").trim();
    return `<!-- page:${index + 1} parser:pp-structure-v3 -->\n\n${markdown}`;
  }).join("\n\n");
  if (!pages.some((page) => String(page?.markdownText || "").trim())) throw new Error("PP-StructureV3 没有识别到可读正文");
  return {
    text,
    ocrUsed: true,
    ocrPages: pages.length,
    pageCount: pages.length,
    parser: PP_STRUCTURE_V3,
    jobId: result.jobId || null,
  };
}

export async function extractPdfWithPpStructureV3(input, { env = process.env, client = null } = {}) {
  if (pdfParserMode(env) !== PP_STRUCTURE_V3) return null;
  const token = String(env.PADDLEOCR_ACCESS_TOKEN || "").trim();
  if (!token && !client) throw new Error("PP-StructureV3 尚未配置：缺少 PADDLEOCR_ACCESS_TOKEN");
  if (!input?.fileUrl && !input?.filePath) throw new Error("PP-StructureV3 缺少可读取的 PDF 地址或文件路径");
  const parser = client || new PaddleOCRClient({
    token,
    ...(env.PADDLEOCR_BASE_URL ? { baseUrl: env.PADDLEOCR_BASE_URL } : {}),
    requestTimeout: 270_000,
    pollTimeout: 270_000,
  });
  try {
    const result = await parser.parseDocument({
      model: Model.PPStructureV3,
      ...(input.fileUrl ? { fileUrl: input.fileUrl } : { filePath: input.filePath }),
      options: {
        useDocOrientationClassify: true,
        useDocUnwarping: false,
        useTextlineOrientation: true,
        useTableRecognition: true,
        useFormulaRecognition: true,
        useChartRecognition: false,
        formatBlockContent: true,
        prettifyMarkdown: true,
        returnMarkdownImages: false,
        visualize: false,
      },
    }, { signal: AbortSignal.timeout(280_000) });
    return ppStructureV3ResultToMarkdown(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PP-StructureV3 解析失败：${message}`, { cause: error });
  }
}
