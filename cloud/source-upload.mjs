import { randomUUID } from "node:crypto";
import { safeFileName } from "./security.mjs";

export const MAX_SOURCE_FILE_BYTES = 200 * 1024 * 1024;
export const ALLOWED_SOURCE_EXTENSIONS = new Set(["pdf", "docx", "md", "txt", "csv"]);

export function validateSourceUpload(input = {}) {
  const name = safeFileName(String(input.name || "source"));
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const size = Number(input.size);
  if (!ALLOWED_SOURCE_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("仅支持 PDF、DOCX、Markdown、TXT 与 CSV 文件"), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw Object.assign(new Error("上传文件为空或大小无效"), { statusCode: 400 });
  }
  if (size > MAX_SOURCE_FILE_BYTES) {
    throw Object.assign(new Error("单个文件最多 200MB，请压缩或拆分后重试"), { statusCode: 413 });
  }
  return { name, size, mimeType: String(input.mimeType || "application/octet-stream") };
}

export function createSourceUploadTarget(ownerId, projectId, input = {}) {
  const validated = validateSourceUpload(input);
  const sourceId = randomUUID();
  return { ...validated, sourceId, path: expectedSourceUploadPath(ownerId, projectId, sourceId, validated.name) };
}

export function expectedSourceUploadPath(ownerId, projectId, sourceId, name) {
  const safeName = safeFileName(name);
  const extension = safeName.includes(".") ? safeName.split(".").pop().toLowerCase() : "bin";
  return `${ownerId}/${projectId}/sources/${sourceId}/${sourceId}.${extension}`;
}
