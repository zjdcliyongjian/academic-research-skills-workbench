# Vercel + Supabase 部署指南

本工作台的云端形态由 Vercel 托管前端与 Serverless API，Supabase 提供身份、Postgres 与 Storage。注册页只收集用户名和密码：服务端会为用户名生成不可逆的内部登录标识，不要求用户提供邮箱，也不发送验证码。

## 1. 创建 Supabase 项目

1. 新建 Supabase 项目，并保存 Project URL、anon key 和 service role key。
2. 在 SQL Editor 中按顺序完整执行：
   - `supabase/migrations/001_cloud_demo.sql`
   - `supabase/migrations/002_api_role_grants.sql`
   - `supabase/migrations/003_ocr_large_upload.sql`
   - `supabase/migrations/004_performance_indexes.sql`
   - `supabase/migrations/005_security_grants.sql`
3. 确认 `research-sources` Storage bucket 已创建，表已启用 RLS，且用户只能访问 `owner_id = auth.uid()` 的数据。

不要把 service role key 或 `BYOK_MASTER_KEY` 放进任何 `VITE_` 变量；`VITE_` 变量会进入浏览器包。

## 2. 创建 Vercel 项目

将本仓库连接到 Vercel。仓库中的 `vercel.json` 已配置：

- `npm run build`
- 静态产物目录 `dist`
- `/api/*` 路由到 `api/index.mjs`
- 其他路径回退到 SPA 的 `index.html`
- Serverless Function 最长运行 300 秒

在 Vercel Project Settings → Environment Variables 中配置：

```text
VITE_DEPLOYMENT_MODE=cloud
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
BYOK_MASTER_KEY=BASE64_ENCODED_32_RANDOM_BYTES
PUBLIC_APP_URL=https://YOUR_VERCEL_DOMAIN
ALLOW_SYNCHRONOUS_DEMO_RUNS=true
MAX_ACTIVE_RUNS_PER_USER=2
MAX_GLOBAL_ACTIVE_RUNS=20
```

生成 `BYOK_MASTER_KEY` 的 PowerShell 示例：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

把输出值直接保存进 Vercel 环境变量，不要写入仓库或聊天记录。

## 3. 初始化管理员

在可信的本地终端临时设置以下变量，并执行 `npm run cloud:bootstrap-admin`：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_ACCOUNT=admin
ADMIN_PASSWORD=<8–12 位，含字母、数字和特殊字符>
```

执行完成后立即清除终端中的 `ADMIN_PASSWORD`。普通试用用户可在登录页自行选择“注册试用”，不需要管理员逐个创建。

## 4. 模型配置

用户登录后打开“模型配置”，选择平台与模型，仅填写自己的 API Key。当前支持：

- 火山方舟 Agent Plan
- DeepSeek
- Kimi 开放平台与 Kimi Code
- 智谱 GLM
- Google Gemini
- OpenAI
- Anthropic Claude

保存前会做最小连接测试；通过后密钥使用 `BYOK_MASTER_KEY` 在服务器端加密，浏览器只看到脱敏提示。每个用户的配置独立存放，不能读取其他账号的密钥。

## 5. 公测试用前检查

```powershell
npm ci
npm run check
```

部署后至少完成以下验收：

1. 新用户名无需邮箱或验证码即可注册、登录和退出。
2. 两个测试账号互相看不到课题、资料、运行记录和模型配置。
3. 上传文件后只能用当前账号的签名地址访问。
4. 错误 API Key 无法保存；正确 API Key 通过连接测试后可切换为默认模型。
5. 删除科研数据不会删除账号或模型 API Key。
6. 管理员操作可在审计记录中追溯。

面向更多公开用户前，建议配置 Upstash Redis 与 QStash，把长任务从同步演示模式迁移到可靠队列，并将 `ALLOW_SYNCHRONOUS_DEMO_RUNS` 调整为 `false`。
