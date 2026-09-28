import { extractBuffer, fetchPublicSource, sha256 } from "./source-processing.mjs";
import { adminClient, listRows, mapSource, oneRow, updateRow } from "./repository.mjs";
import { pdfParserMode } from "../shared/pp-structure-v3.mjs";
import { ocrParserEnv } from "./ocr-config.mjs";

const storage = () => adminClient().storage.from("research-files");

async function storageUpload(path, value, contentType) {
  const result = await storage().upload(path, value, { contentType, upsert: true });
  if (result.error) throw new Error(result.error.message);
}

async function storageDownload(path) {
  const result = await storage().download(path);
  if (result.error) throw new Error(result.error.message);
  return Buffer.from(await result.data.arrayBuffer());
}

async function storageSignedUrl(path) {
  const result = await storage().createSignedUrl(path, 15 * 60);
  if (result.error || !result.data?.signedUrl) throw new Error(result.error?.message || "无法为 PDF 创建临时解析地址");
  return result.data.signedUrl;
}

export async function processSourceJob(ownerId, projectId, sourceId) {
  await oneRow("projects", ownerId, projectId);
  let source = await oneRow("sources", ownerId, sourceId);
  if (source.project_id !== projectId) throw Object.assign(new Error("来源不属于当前课题"), { statusCode: 403 });
  await updateRow("sources", ownerId, source.id, { processing_status: "processing", failure_reason: null });
  try {
    let buffer;
    let mimeType = source.mime_type || "application/octet-stream";
    let snapshotUrl = source.snapshot_url;
    if (source.kind === "url") {
      const fetched = await fetchPublicSource(source.url);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
      const extension = mimeType.includes("pdf") ? ".pdf" : mimeType.includes("html") ? ".html" : ".txt";
      snapshotUrl = `${ownerId}/${source.project_id}/snapshots/${source.id}${extension}`;
      await storageUpload(snapshotUrl, buffer, mimeType);
    } else {
      buffer = await storageDownload(source.blob_url);
    }
    const isPdf = mimeType === "application/pdf" || String(source.name || "").toLowerCase().endsWith(".pdf");
    const [ocrConfig] = isPdf ? await listRows("model_configs", ownerId, { provider: "paddleocr", model: "pp-structure-v3" }, { column: "updated_at" }) : [];
    const parserEnv = ocrParserEnv(ocrConfig);
    const pdfPath = source.kind === "url" ? snapshotUrl : source.blob_url;
    const usePpStructure = isPdf && pdfParserMode(parserEnv) === "pp-structure-v3";
    const pdfInput = usePpStructure && pdfPath ? { fileUrl: await storageSignedUrl(pdfPath) } : undefined;
    const extracted = await extractBuffer(buffer, mimeType, source.name, source.url, { pdfInput, parserEnv });
    source = await updateRow("sources", ownerId, source.id, {
      sha256: sha256(buffer), size: buffer.length, mime_type: mimeType, snapshot_url: snapshotUrl,
      extracted_text: extracted.text.slice(0, 1_000_000), title: extracted.title, authors: extracted.authors,
      publication_year: extracted.publicationYear, venue: extracted.venue, doi: extracted.doi,
      ocr_used: extracted.ocrUsed, ocr_pages: extracted.ocrPages, processing_status: "metadata_pending",
      processed_at: new Date().toISOString(), status: "raw",
    });
    const duplicates = (await listRows("sources", ownerId, { project_id: projectId }, null, "id,sha256"))
      .filter((item) => item.id !== source.id && item.sha256 && item.sha256 === source.sha256)
      .map((item) => item.id);
    return { source: mapSource(source), duplicateSourceIds: duplicates };
  } catch (error) {
    await updateRow("sources", ownerId, source.id, { processing_status: "failed", failure_reason: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
