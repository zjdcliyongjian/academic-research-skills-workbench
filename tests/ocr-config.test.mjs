import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "../cloud/crypto.mjs";
import { ocrParserEnv, publicOcrConfig } from "../cloud/ocr-config.mjs";

describe("per-user OCR configuration", () => {
  const original = process.env.BYOK_MASTER_KEY;
  beforeEach(() => { process.env.BYOK_MASTER_KEY = randomBytes(32).toString("base64"); });
  afterEach(() => { if (original === undefined) delete process.env.BYOK_MASTER_KEY; else process.env.BYOK_MASTER_KEY = original; });

  it("returns only safe metadata to the browser", () => {
    const row = { provider: "paddleocr", key_hint: "92••••9f5", enabled: true, updated_at: "2026-09-24T00:00:00Z", encrypted_api_key: "secret" };
    expect(publicOcrConfig(row)).toEqual({ configured: true, provider: "paddleocr", keyHint: "92••••9f5", enabled: true, updatedAt: "2026-09-24T00:00:00Z" });
    expect(JSON.stringify(publicOcrConfig(row))).not.toContain("encrypted_api_key");
  });

  it("decrypts only the current user's token for PP-StructureV3", () => {
    const row = { enabled: true, encrypted_api_key: encryptSecret("paddle-user-token-123456") };
    const env = ocrParserEnv(row, { PDF_PARSER: "auto", PADDLEOCR_ACCESS_TOKEN: "platform-token" });
    expect(env.PDF_PARSER).toBe("pp-structure-v3");
    expect(env.PADDLEOCR_ACCESS_TOKEN).toBe("paddle-user-token-123456");
  });

  it("forces legacy parsing when the user has no OCR token", () => {
    const env = ocrParserEnv(null, { PDF_PARSER: "pp-structure-v3", PADDLEOCR_ACCESS_TOKEN: "platform-token" });
    expect(env.PDF_PARSER).toBe("legacy");
    expect(env.PADDLEOCR_ACCESS_TOKEN).toBe("");
  });
});
