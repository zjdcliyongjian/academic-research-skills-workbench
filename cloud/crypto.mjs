import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey() {
  const encoded = process.env.BYOK_MASTER_KEY || "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("密钥加密服务配置无效，请联系管理员");
  }
  return key;
}

export function encryptSecret(value) {
  if (!value || value.length < 8) throw new Error("API Key 格式不完整");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload) {
  const [version, ivValue, tagValue, ciphertextValue] = String(payload || "").split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("模型密钥密文格式无效");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export function keyHint(value) {
  const clean = String(value || "").trim();
  return clean.length > 8 ? `${clean.slice(0, 3)}••••${clean.slice(-4)}` : "••••••••";
}
