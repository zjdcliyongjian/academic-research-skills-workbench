import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.mjs";

const COOKIE_NAME = "ars_local_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

db.exec(`
  CREATE TABLE IF NOT EXISTS local_accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES local_accounts(username) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_local_sessions_expiry ON local_sessions(expires_at);
`);

function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizeAccount(value) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lower)) return lower;
  const compact = raw.replace(/[\s-]/g, "");
  const phone = compact.startsWith("+86") ? compact.slice(3) : compact.startsWith("86") && compact.length === 13 ? compact.slice(2) : compact;
  if (/^1[3-9]\d{9}$/.test(phone)) return phone;
  const username = raw.normalize("NFKC").toLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u.test(username)) {
    throw error("请输入邮箱、手机号，或 3–32 位中英文用户名");
  }
  if (username === "admin") throw error("admin 是系统保留管理员账号，不能注册");
  return username;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password) || /\s/.test(password)) {
    throw error("密码必须为 8–12 位，并且同时包含字母、数字和特殊字符（例如 @）");
  }
  return password;
}

function passwordHash(password, salt) {
  return scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function issueSession(username) {
  db.prepare("DELETE FROM local_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  db.prepare("INSERT INTO local_sessions(token_hash,username,expires_at,created_at) VALUES(?,?,?,?)")
    .run(tokenHash(token), username, expiresAt, now.toISOString());
  return token;
}

export function registerLocalAccount(account, passwordValue) {
  const username = normalizeAccount(account);
  const password = validatePassword(passwordValue);
  if (db.prepare("SELECT username FROM local_accounts WHERE username = ?").get(username)) throw error("该账号已注册，请直接登录", 409);
  const salt = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO local_accounts(username,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,?)")
    .run(username, passwordHash(password, salt), salt, "user", "active", new Date().toISOString());
  return { user: { id: `local:${username}`, username, role: "user", status: "active" }, token: issueSession(username) };
}

export function loginLocalAccount(account, passwordValue) {
  const username = normalizeAccount(account);
  const password = validatePassword(passwordValue);
  const row = db.prepare("SELECT * FROM local_accounts WHERE username = ?").get(username);
  if (!row || row.status !== "active") throw error("账号或密码不正确", 401);
  const actual = Buffer.from(passwordHash(password, row.password_salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw error("账号或密码不正确", 401);
  return { user: { id: `local:${row.username}`, username: row.username, role: row.role, status: row.status }, token: issueSession(row.username) };
}

export function localSession(req) {
  const token = cookies(req)[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`SELECT a.username,a.role,a.status,s.expires_at FROM local_sessions s JOIN local_accounts a ON a.username=s.username WHERE s.token_hash=?`).get(tokenHash(token));
  if (!row || row.status !== "active" || Date.parse(row.expires_at) <= Date.now()) return null;
  return { id: `local:${row.username}`, username: row.username, role: row.role, status: row.status };
}

export function requireLocalSession(req) {
  const user = localSession(req);
  if (!user) throw error("请先登录", 401);
  return user;
}

export function logoutLocalSession(req) {
  const token = cookies(req)[COOKIE_NAME];
  if (token) db.prepare("DELETE FROM local_sessions WHERE token_hash=?").run(tokenHash(token));
}

export function setLocalSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
}

export function clearLocalSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}
