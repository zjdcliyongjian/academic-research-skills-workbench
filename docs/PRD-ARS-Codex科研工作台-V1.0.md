# ARS-Codex 科研工作台 PRD V1.0

## 1. 产品定义

ARS-Codex 科研工作台是一个 Windows 本地优先、单用户的科研流程工作台。它把 `academic-research-skills-codex` 的路由、检查点和质量门变成可视化、可追溯、可人工确认的产品流程。

产品不承诺自动产出“正确论文”，也不替代导师、作者、伦理委员会、期刊编辑或正式投稿系统。

## 2. 首版目标

1. 一个课题对应一个本地项目目录、一个 Codex 线程和一套版本记录。
2. 每次运行只附加一个物理 Skill：`academic-research-suite`。
3. 工作台用 7 个逻辑能力明确路由到 5 个 ARS workflow。
4. 所有 AI 输出先进入草稿层，作者采用后才形成阶段正式版本。
5. 来源、证据、冲突、作者裁决和阶段版本进入 Material Passport 边界。
6. 正式导出只装配人工采用的版本。

## 3. 核心用户

- 需要搭建个人科研流程的研究生、教师和独立研究者。
- 需要把文献、写作、评审、返修串成可追溯闭环的用户。
- 已经使用 Codex Desktop / Codex CLI，愿意保留人工检查点的用户。

## 4. 主流程

`资料与证据 → 范围界定 → 深度调研 → 论文写作 → 完整性核验Ⅰ → 同行评审 → 返修与复审 → 最终核验与定稿 → 正式导出`

| 工作台能力 | 物理 Skill | ARS 路由 | 人工门 |
|---|---|---|---|
| 范围界定 | academic-research-suite | deep-research / socratic | 作者确认研究问题与边界 |
| 深度调研 | academic-research-suite | deep-research | 作者核验来源、全文读取状态与关键判断 |
| 论文写作 | academic-research-suite | academic-paper | 作者确认结构、引用和贡献表述 |
| 完整性核验Ⅰ | academic-research-suite | academic-pipeline / Stage 2.5 | 阻断项关闭后才能评审 |
| 同行评审 | academic-research-suite | academic-paper-reviewer / full | 默认只读，作者确认评审目标 |
| 返修与复审 | academic-research-suite | academic-paper / revision | 仅修改作者明确采纳的项目 |
| 最终核验与定稿 | academic-research-suite | academic-pipeline / Stage 4.5 | 阻断项关闭且作者确认后定稿 |

## 5. 功能范围

### F01 课题与本地空间

- 创建、暂停、完成课题。
- 每个课题独立保存来源、证据、运行、草稿、正式版本、Passport 和导出。

### F02 来源与证据

- 支持 PDF、DOCX、Markdown、TXT、CSV 和 URL 登记。
- 保存哈希、解析状态、OCR 状态、元数据和来源快照。
- 证据分为来源事实、综合、推论和未知；冲突与未核验不可混入已证实事实。

### F03 ARS 路由

- UI 展示 7 个逻辑能力。
- 后端将逻辑能力映射到单一物理 Skill。
- 提示词明确 workflow、阶段、停止点、输入、产物和人工检查点。

### F04 草稿与版本

- 运行结果自动保存为草稿。
- 支持采用、要求修改、驳回、重试、取消和运行历史。
- 上游正式版本变化时，下游版本标记为需要复核。

### F05 Material Passport

- 展示已核验来源、已核验事实、正式版本和未解决项。
- 为跨阶段交接提供材料边界与本地 ledger 目录。
- Passport 不是正确性证书；缺失或损坏不能证明步骤完成。

### F06 完整性与评审

- Stage 2.5 与 4.5 是显式质量门。
- 评审默认只读，稿件修改必须进入返修流程。
- 程序化引文验证、跨模型调用和外部 API 不因 `ars-full` 自动启用。

### F07 导出

- Markdown、DOCX、BibTeX、LaTeX、ZIP 交付包。
- 正式导出只读取当前有效的人工采用版本。
- 包含来源、版本、哈希、限制与未解决项说明。

## 6. 非功能要求

- 默认仅监听 `127.0.0.1`。
- 原始资料只读；删除尽量进入项目回收区。
- 工作台不记录或上传 Codex 凭据。
- 视觉使用“个人自生长知识库 4.0”现代知识编辑风格。
- 1920×1080 和常见笔记本宽度不出现关键内容溢出。

## 7. 首版不做

- 不承诺云端 ARS 完整运行。
- 不自动提交期刊、会议或伦理审批。
- 不自动启用 cross-model、Semantic Scholar、OpenAlex、Crossref 等程序化网络路径。
- 不把数值评分、覆盖率或 Passport 状态宣传为论文正确性、创新性或可发表性证明。

## 8. 验收标准

1. 健康检查能发现并启用 `academic-research-suite`。
2. 7 个逻辑能力均显示“已安装”，路径指向同一个物理 Skill。
3. 任一阶段运行时，Codex input 只附加一个物理 Skill。
4. 采用结果后，项目阶段、正式版本和下游复核状态正确更新。
5. Material Passport 状态与真实来源、证据和版本统计一致。
6. `npm run check` 通过。
7. 本地服务可启动，页面可在 Chrome 正常渲染。
8. 文档明确保留上游署名、CC BY-NC 4.0 边界与独立集成声明。
