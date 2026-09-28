import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const username = String(process.env.ADMIN_ACCOUNT || "admin").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceKey || !password) {
  throw new Error("请先设置 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 和 ADMIN_PASSWORD 环境变量");
}
if (username !== "admin") throw new Error("当前版本只允许初始化保留管理员账号 admin");
if (password.length < 8 || password.length > 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password) || /\s/.test(password)) {
  throw new Error("管理员密码必须为 8–12 位，并且同时包含字母、数字和特殊字符（例如 @）");
}

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `${username}@research-copilot.local`;
let page = 1;
let existing = null;
while (!existing) {
  const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) throw result.error;
  existing = result.data.users.find((user) => user.email === email) || null;
  if (existing || result.data.users.length < 1000) break;
  page += 1;
}

const attributes = {
  email,
  password,
  email_confirm: true,
  user_metadata: { username, display_name: username },
  app_metadata: { role: "admin" },
};
const result = existing
  ? await client.auth.admin.updateUserById(existing.id, attributes)
  : await client.auth.admin.createUser(attributes);
if (result.error || !result.data.user) throw result.error || new Error("管理员创建失败");

const profile = await client.from("profiles").upsert({
  id: result.data.user.id,
  username,
  display_name: username,
  role: "admin",
  status: "active",
  force_logout_at: null,
  updated_at: new Date().toISOString(),
}, { onConflict: "id" });
if (profile.error) throw profile.error;

process.stdout.write(`管理员账号 ${username} 已安全初始化。密码未写入文件或日志。\n`);
