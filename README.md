# AI 科研工作台

一个面向研究者的开源 AI 科研工作台，把“研究问题 → 来源与证据 → 文献调研 → 论文蓝图 → 章节写作 → 图表与整稿 → 投稿审查 → 正式交付”放进一条可追溯、可人工确认的工作流。

> AI 只提供候选分析与草稿。研究结论、实验数据、引文、署名、伦理与投稿决定始终由研究者负责。

## 能做什么

- 为每个课题建立独立研究目录与来源台账。
- 导入 PDF、DOCX、Markdown、TXT、CSV 或网页来源，保留文件哈希与处理状态。
- 区分来源事实、综合判断、推断和未知项，形成可核验的证据卡。
- 支持 Idea 评估、深度调研、论文蓝图、章节写作、润色、图表设计、投稿前审查和审稿回应等研究任务。
- 所有关键阶段都保留“采用 / 驳回 / 要求修改”的人工确认点。
- 正式导出只读取人工采用版本，支持 Markdown、Word、BibTeX、LaTeX 和交付包 ZIP。
- 同时支持本地单机模式，以及 Vercel + Supabase 的自部署云端模式。

## 快速开始

### 环境要求

- Node.js 24 或更高版本
- npm
- Windows 用户可直接使用项目内的启动/停止脚本；macOS 与 Linux 可使用 npm 命令启动。

### 本地单机模式

```bash
git clone https://github.com/zjdcliyongjian/ai-research-copilot-workbench.git
cd ai-research-copilot-workbench
npm install
npm run build
npm run server
```

启动后访问 `http://127.0.0.1:4317`。

Windows 用户也可以在完成 `npm install` 后双击 `启动AI科研副导师工作台.bat`；停止时双击 `停止AI科研副导师工作台.bat`。

默认数据保存在仓库内的 `data/`，默认科研 Vault 位于当前用户主目录下的 `AIResearchCopilotVault/`。可通过以下环境变量调整：

- `AI_RESEARCH_DATA_DIR`：运行数据库与状态目录
- `AI_RESEARCH_VAULT_ROOT`：科研 Vault 根目录
- `AI_RESEARCH_PORT`：本地服务端口，默认从 `4317` 开始

### 云端自部署

1. 复制 `.env.example` 为 `.env.local`，填写自己的 Supabase、BYOK 加密主密钥、队列与限流配置。
2. 按顺序执行 `supabase/migrations/` 下的 SQL。
3. 参考 [CLOUD-DEPLOYMENT.md](./CLOUD-DEPLOYMENT.md) 完成 Vercel、Supabase、QStash 与 Upstash 配置。
4. 不要把 `.env.local`、服务端密钥、模型 API Key、用户上传文件或数据库提交到 Git。

## 数据与安全边界

- 本地数据、数据库、上传文件、构建产物和环境变量均已被 `.gitignore` 排除。
- 云端模式按账号隔离数据；模型与 OCR 服务使用用户自备密钥。
- 配置 PaddleOCR 后，PDF 会通过短时签名地址提交给外部服务处理；保密材料应保持未配置或使用本地解析。
- 当前注册流程适合自部署演示，不等同于完成企业级身份核验、合规审计或大规模并发压测。
- 更多说明见 [PRIVACY.md](./PRIVACY.md) 与 [SECURITY.md](./SECURITY.md)。

## 项目结构

```text
src/          React 前端
server/       本地单机服务与科研 Vault
cloud/        云端 API、模型网关与任务处理
supabase/     数据库迁移
tests/        自动化测试
phase-*/      研究流程与产品设计文档
scripts/      启动、停止与初始化脚本
```

## 开发与验证

```bash
npm run typecheck
npm test
npm run build
# 或一次执行全部检查
npm run check
```

欢迎提交 Issue、改进文档或贡献代码。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 联系与关注

- 微信：`zzshare147`
- 邮箱：[1209655870@qq.com](mailto:1209655870@qq.com)
- 小红书号：`94138309455`
- 抖音号：`88873534669`
- B站与视频号：可扫描下方二维码关注“智见洞察”

<table>
  <tr>
    <th>微信</th>
    <th>小红书</th>
    <th>抖音</th>
    <th>视频号</th>
    <th>B站</th>
  </tr>
  <tr>
    <td><img src="src/assets/contact/wechat.jpg" width="150" alt="智见洞察微信二维码"></td>
    <td><img src="src/assets/contact/xiaohongshu.jpg" width="150" alt="智见洞察小红书二维码"></td>
    <td><img src="src/assets/contact/douyin.jpg" width="150" alt="智见洞察抖音二维码"></td>
    <td><img src="src/assets/contact/channels.jpg" width="150" alt="智见洞察视频号二维码"></td>
    <td><img src="src/assets/contact/bilibili.jpg" width="150" alt="智见洞察B站二维码"></td>
  </tr>
</table>

## 许可证

本项目采用 [MIT License](./LICENSE)。
