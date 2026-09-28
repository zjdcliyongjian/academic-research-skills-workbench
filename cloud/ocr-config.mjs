import { decryptSecret } from "./crypto.mjs";

export function publicOcrConfig(row) {
  if (!row) return { configured: false, provider: "paddleocr", keyHint: null, enabled: false, updatedAt: null };
  return {
    configured: true,
    provider: row.provider || "paddleocr",
    keyHint: row.key_hint || null,
    enabled: true,
    updatedAt: row.updated_at || null,
  };
}

export function ocrParserEnv(row, baseEnv = process.env) {
  if (!row) {
    return { ...baseEnv, PDF_PARSER: "legacy", PADDLEOCR_ACCESS_TOKEN: "" };
  }
  return {
    ...baseEnv,
    PDF_PARSER: "pp-structure-v3",
    PADDLEOCR_ACCESS_TOKEN: decryptSecret(row.encrypted_api_key),
  };
}
