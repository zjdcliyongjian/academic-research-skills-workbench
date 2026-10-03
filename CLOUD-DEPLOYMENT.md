# Vercel + Supabase 产品演示部署

## 当前边界

- Vercel：React 页面、同源 API、短时模型任务入口。
- Supabase Auth：工作台账号＋密码登录。普通账号可填写中国大陆手机号或邮箱；试用阶段只作为登录标识，映射后的内部认证邮箱不在界面展示。
- Supabase PostgreSQL：课题、证据、运行、人工审阅、正式版本、模型配置元数据。
- Supabase Storage：私有来源文件、网页快照和导出文件。
- 用户 BYOK：API Key 使用 `AES-256-GCM` 加密后入库，只在服务端模型调用时解密。
- Upstash Redis：可选的接口限流；没有配置时由 Supabase 租户隔离保护数据，但缺少跨实例限流。
- QStash：外部试用前建议启用。演示阶段可以用 `waitUntil` 执行短任务。

云端模式不调用本机 `codex.exe`、PowerShell、Windows 注册表或本地 Vault。本地版入口和数据保持原样。

## 1. 创建 Supabase 项目

1. 在 Supabase 创建项目，记录 Project URL、anon key 和 service role key。
2. 打开 SQL Editor，执行 `supabase/migrations/001_cloud_demo.sql`。
3. 在 Authentication 中启用 Email。普通账号由服务端创建为已确认的内部账号，不发送短信或验证邮件。
4. 检查 Storage 中存在私有 bucket：`research-files`。

Supabase 免费计划可用于这一阶段的演示。当前版本不使用短信验证码，因此不需要配置 SMS Provider。

不要把 `service role key` 或 `BYOK_MASTER_KEY` 写进 `VITE_` 开头的环境变量。

## 2. 生成 BYOK 主密钥

PowerShell：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

只把输出保存为 Vercel 的 `BYOK_MASTER_KEY`。密钥丢失后，已保存的用户 API Key 无法恢复；轮换前需要设计密钥版本迁移。

## 3. 配置 Vercel

将 `.env.example` 中的变量写入 Vercel Project Settings。最少需要：

- `VITE_DEPLOYMENT_MODE=cloud`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BYOK_MASTER_KEY`
- `ALLOW_SYNCHRONOUS_DEMO_RUNS=false`
- `MAX_ACTIVE_RUNS_PER_USER=2`
- `MAX_GLOBAL_ACTIVE_RUNS=20`
- 不再配置平台共享的 `PADDLEOCR_ACCESS_TOKEN`；每位用户在“模型配置 → PDF 解析服务”中填写自己的百度 AI Studio Token，服务端使用 `BYOK_MASTER_KEY` 加密保存。

外部试用必须同时配置 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`、`QSTASH_TOKEN`、`QSTASH_CURRENT_SIGNING_KEY`、`QSTASH_NEXT_SIGNING_KEY` 和 `PUBLIC_APP_URL`。当前线上访问域名为 `https://academic-research-skills-workbench.vercel.app`，因此生产环境的 `PUBLIC_APP_URL` 应填写同一地址。运行任务与 PDF/OCR 来源处理都会进入 QStash，Redis 负责跨实例限流和全局并发背压。`ALLOW_SYNCHRONOUS_DEMO_RUNS=true` 只适合本地或短时演示。

用户配置 PaddleOCR Token 后，PDF 会优先通过官方托管的 PP-StructureV3 解析。处理时，服务端会向 PaddleOCR 提交一个 15 分钟有效的私有文件签名地址；这意味着 PDF 内容会离开本系统并由 PaddleOCR 服务处理。未配置 Token 的账号自动使用 PDF.js＋Tesseract，不会把 PDF 提交给百度。涉及保密、未公开或受数据出境约束的资料应保持未配置状态，或删除个人 Token。不要把任何用户 Token 写入 `VITE_` 变量、日志或平台共享环境变量。

构建命令和新加坡区域已经写入 `vercel.json`。部署后先用一个账号走完注册、上传、来源处理和一次运行，再邀请外部用户；不要把“部署成功”当作队列和模型网关已经验收。

## 4. 初始化管理员账号

管理员角色必须由 Supabase service role 在服务端写入，不能从注册页面自助获得。数据库迁移完成后，在私有 PowerShell 会话中临时设置：

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
$env:ADMIN_ACCOUNT="admin"
$env:ADMIN_PASSWORD="在此临时填写管理员密码"
npm run cloud:bootstrap-admin
Remove-Item Env:ADMIN_PASSWORD
```

脚本只输出初始化结果，不输出或保存密码。管理员登录后会看到“管理后台”，可以查看普通用户的课题文件、强制下线、禁用和恢复账号；所有跨用户操作写入 `admin_audit_logs`。

## 5. 模型支持

工作台以 OpenAI-compatible `chat/completions` 接口连接模型，内置以下入口：

- 通义千问（DashScope compatible mode）
- DeepSeek
- 智谱 GLM
- Kimi
- 豆包 / 火山方舟
- 百度千帆
- 腾讯混元
- MiniMax
- 零一万物
- 阶跃星辰
- OpenAI
- 其他公开 HTTPS OpenAI-compatible 接口

用户必须填写实际模型 ID 和自己的 API Key。点击“测试连接并保存”后，服务端会先发起一次限制为极少输出的真实连接测试；只有接口、密钥和模型 ID 均可用时才加密保存。工作台不替模型服务商计费，也不会把 Key 返回浏览器或写入运行日志。

## 6. 产品演示验收

1. 新用户使用中国大陆手机号或邮箱完成注册和登录；密码为 8–12 位且同时包含字母、数字和特殊字符；保留管理员账号不能被普通用户注册。
2. 两个不同账号互相看不到课题、来源、运行和文件。
3. 配置模型时必须通过真实连接测试；保存后系统页显示“BYOK 模型网关 ready”。
4. 创建课题、上传小于 4MB 的测试资料、处理并人工确认来源。
5. 运行一个 Skill；任务状态从排队中变为运行中，再变为已完成。
6. 采用结果后生成正式版本，再导出 Markdown 或 Word。
7. 未采用任何版本时，正式导出必须被拒绝。
8. 取消运行后，迟到的模型结果不得覆盖“已取消”状态。

9. 管理员可查看普通用户文件、强制下线及禁用/恢复账号，普通用户看不到管理后台。
10. 用户提交 Bug 或功能建议后返回反馈编号，管理员后续可在数据库中追踪状态。

## 7. 免费额度与 200 并发

Supabase 免费额度适合产品演示，不等于能稳定承载 200 个同时执行模型任务的研究用户。当前接口已按用户隔离，并为 Redis/QStash/独立 Worker 预留边界；正式试用前至少需要：

- 启用 QStash 或独立任务队列，长任务移出 Vercel 请求生命周期；
- 配置 Upstash 限流、每用户并发上限和全局队列背压；
- 当前版本已提供单实例请求限流回退、每账号活动任务上限和 Redis 全局活动任务上限；多实例统一限流和背压仍必须配置 Upstash Redis；
- 改为浏览器直传 Supabase，以支持大文件并绕开 Vercel 请求体限制；
- 增加模型费用上限、用量统计、失败重试和管理员审计；
- 做 200 用户的阶梯压测，而不是把“200 注册用户”误当作“200 同时跑长任务”。
