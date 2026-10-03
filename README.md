# academic-research-skills 工作台

一个基于 [academic-research-skills-codex](https://github.com/Imbad0202/academic-research-skills-codex) 的可追溯、带人工检查点的科研工作台，同时支持本地单用户运行与 Vercel + Supabase 多用户试用。

主流程：

`资料与证据 → 范围界定 → 深度调研 → 论文写作 → 完整性核验Ⅰ → 同行评审 → 返修与复审 → 最终核验与定稿 → 正式导出`

> AI 只提供候选分析与草稿。研究问题、实验、引文、署名、伦理/机构授权、返修裁决和最终提交始终由研究者负责。

## 设计原则

- UI 展示 7 个逻辑能力，但运行时只附加一个物理 Skill：`academic-research-suite`。
- 每轮提示词明确 ARS workflow、阶段、输入、产物、停止点和人工门。
- 原始材料只读；AI 输出先进入草稿层，作者采用后才形成正式版本。
- Material Passport 记录来源、证据、版本、作者裁决和检查点，但不是正确性证书。
- Stage 2.5 与 Stage 4.5 是显式完整性门。
- PDF 页码锚点先做结构预检；PASS 只表示具备建立页码定位的结构条件。
- 程序化引文验证默认走项目本地缓存，且每次都要求研究者逐字授权；外部 bibliographic API 和 cross-model 不会自动开启。
- Schema 9 原件隔离保存并可原样导出；工作台只声明实际通过的兼容检查范围。
- 返修裁决逐项记录作者原话与授权目标，工作台不替作者推断决定。

## 环境要求

- Node.js 24+
- npm
- 已安装并登录 Codex CLI / Codex Desktop
- 已安装上游 ARS Skill

安装上游 Skill（项目已在当前开发机安装）：

```powershell
python C:\Users\Lenovo\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py --repo Imbad0202/academic-research-skills-codex --ref main --path skills/academic-research-suite --method git
```

安装后请开启一个新的 Codex 会话，让 Skill 列表刷新。

## 本地启动

```powershell
npm install
npm run setup:ars-runtime
npm run build
npm run server
```

访问 `http://127.0.0.1:4317`。

登录页视觉预览：`http://127.0.0.1:4317/?preview=login`。本地预览不会创建账号；部署为云端模式后，用户名注册、登录和用户数据隔离才会启用。

默认数据：

- 工作台数据库：仓库内 `data/`
- 科研 Vault：`%USERPROFILE%\ARSCodexResearchVault`
- ARS Skill：`%USERPROFILE%\.codex\skills\academic-research-suite`
- 结构化 Passport：每个课题的 `10-passport/material-passport.json`
- ARS run ledger：每个课题的 `10-passport/material-passport_run_ledger.yaml`
- Schema 9 隔离导入：每个课题的 `10-passport/schema9/imports/`
- PDF 与书目核验记录：每个课题的 `10-passport/verification/`

`npm run setup:ars-runtime` 只在仓库的 `.ars-runtime/` 安装上游
集成脚本所需的 PyYAML、jsonschema 与 pypdf，不修改 ARS Skill 源码。若运行依赖缺失或上游脚本拒绝写入，工作台会把对应能力标记为不可用或失败，并保留诊断，不会伪装成成功。

可用环境变量：

- `AI_RESEARCH_DATA_DIR`
- `AI_RESEARCH_VAULT_ROOT`
- `AI_RESEARCH_PORT`

## 验证

```powershell
npm run check
```

## 文档

- [PRD V1.0](docs/PRD-ARS-Codex科研工作台-V1.0.md)
- [实施计划](docs/IMPLEMENTATION-PLAN.md)
- [Vercel + Supabase 部署指南](docs/VERCEL-SUPABASE-DEPLOYMENT.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [隐私说明](PRIVACY.md)
- [安全说明](SECURITY.md)

## 许可证与边界

工作台应用代码使用 [MIT License](LICENSE)。

上游 `academic-research-skills-codex` 为独立安装依赖，采用 CC BY-NC 4.0；其非商业限制、署名要求与其他条款仍然适用。本项目是独立集成，不代表上游作者背书。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

云端版支持用户名与密码注册试用，不要求邮箱或验证码；每个账号的课题、资料、运行记录、导出文件与模型配置均按用户隔离。模型 API Key 只在服务端加密保存，模型调用费用仍由用户选择的服务商收取。
