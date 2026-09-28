import { createHash } from "node:crypto";

function requiredString(value, label, max) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(`${label}不能为空`), { statusCode: 400 });
  if (text.length > max) throw Object.assign(new Error(`${label}超过长度上限`), { statusCode: 400 });
  return text;
}

export function normalizeTrialAccount(value) {
  const raw = requiredString(value, "账号", 254);
  const lower = raw.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lower)) return lower;
  const compact = raw.replace(/[\s-]/g, "");
  const phone = compact.startsWith("+86") ? compact.slice(3) : compact.startsWith("86") && compact.length === 13 ? compact.slice(2) : compact;
  if (/^1[3-9]\d{9}$/.test(phone)) return phone;
  throw Object.assign(new Error("请输入有效的中国大陆手机号或邮箱地址"), { statusCode: 400 });
}

export function validateTrialPassword(value) {
  const password = requiredString(value, "密码", 12);
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password) || /\s/.test(password)) {
    throw Object.assign(new Error("密码必须为 8–12 位，并且同时包含字母、数字和特殊字符（例如 @）"), { statusCode: 400 });
  }
  return password;
}

export function trialLoginEmail(account) {
  const hash = createHash("sha256").update(account).digest("hex").slice(0, 40);
  return `trial-${hash}@research-copilot.local`;
}
