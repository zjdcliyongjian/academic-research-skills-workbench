import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase().split("%")[0];
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.");
}

export async function assertPublicHttpsUrl(value, label = "接口地址") {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label}不是有效网址`); }
  if (parsed.protocol !== "https:") throw new Error(`${label}必须使用 HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${label}不能包含用户名或密码`);
  if (parsed.port && parsed.port !== "443") throw new Error(`${label}仅允许标准 HTTPS 端口`);
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error(`${label}解析到本机、私网或保留地址，已拒绝访问`);
  }
  return parsed;
}

export function safeFileName(value, fallback = "file") {
  const cleaned = String(value || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 180);
}

export function slugify(value) {
  return String(value || "project").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80) || "project";
}
