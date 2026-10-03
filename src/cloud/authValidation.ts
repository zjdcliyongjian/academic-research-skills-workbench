export const PASSWORD_RULE_MESSAGE = "密码必须为 8–12 位，并且同时包含字母、数字和特殊字符（例如 @）。";

export type AuthIdentity =
  | { kind: "admin"; account: "admin"; email: string; displayName: "admin" }
  | { kind: "username"; account: string; displayName: string }
  | { kind: "email"; account: string; email: string; displayName: string }
  | { kind: "phone"; account: string; phone: string; displayName: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const usernamePattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u;

export function resolveAuthIdentity(value: string): AuthIdentity | null {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  if (lower === "admin") return { kind: "admin", account: "admin", email: "admin@research-copilot.local", displayName: "admin" };
  if (raw.length <= 254 && emailPattern.test(lower)) return { kind: "email", account: lower, email: lower, displayName: lower };

  const compact = raw.replace(/[\s-]/g, "");
  const localPhone = compact.startsWith("+86") ? compact.slice(3) : compact.startsWith("86") && compact.length === 13 ? compact.slice(2) : compact;
  if (mainlandPhonePattern.test(localPhone)) return { kind: "phone", account: localPhone, phone: `+86${localPhone}`, displayName: localPhone };
  const normalizedUsername = raw.normalize("NFKC").toLowerCase();
  if (usernamePattern.test(normalizedUsername)) return { kind: "username", account: normalizedUsername, displayName: normalizedUsername };
  return null;
}

export function passwordRuleError(password: string): string {
  if (password.length < 8 || password.length > 12) return PASSWORD_RULE_MESSAGE;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password) || /\s/.test(password)) return PASSWORD_RULE_MESSAGE;
  return "";
}

export async function trialLoginEmail(identity: AuthIdentity): Promise<string> {
  if (identity.kind === "admin") return identity.email;
  const bytes = new TextEncoder().encode(identity.account);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `trial-${hash.slice(0, 40)}@research-copilot.local`;
}
