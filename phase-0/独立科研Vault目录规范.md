# AI 科研副导师独立 Vault 目录规范

> 版本：v0.1（阶段 0）  
> 状态：结构已确认，实际 Vault 根路径在阶段 1 初始化时写入工作台设置  
> 原则：原始资料只读、来源可追溯、AI 输出和人工确认分层、项目可独立迁移

## 1. 根目录约定

工作台不与现有 LLMwiki、内容 Agent 或其他 Obsidian Vault 混放。运行时使用用户选择的绝对路径作为 `${VAULT_ROOT}`，工作台只允许在该根目录及显式授权的导入目录内操作。

建议默认路径：

`<USER_HOME>\AIResearchCopilotVault`

若该路径已存在，初始化程序不得覆盖，必须要求选择“接管已有 Vault”或“创建新目录”。

## 2. Vault 顶层结构

```text
${VAULT_ROOT}/
├─ 00-工作台入口/
│  ├─ index.md
│  ├─ 项目总览.md
│  └─ 待人工确认.md
├─ 01-项目/
│  └─ {project-id}-{project-slug}/
├─ 02-共享方法/
│  ├─ 研究方法/
│  ├─ 写作规范/
│  └─ 图表规范/
├─ 03-共享来源/
│  ├─ 人物与机构/
│  ├─ 期刊与会议/
│  └─ 数据集与工具/
├─ 90-模板/
├─ 98-导出/
└─ 99-系统/
   ├─ settings.json
   ├─ skill-registry.json
   ├─ citation-schema.json
   └─ migrations/
```

## 3. 单项目结构

```text
01-项目/{project-id}-{project-slug}/
├─ 00-index.md
├─ 01-brief/
│  ├─ 课题卡.md
│  ├─ 约束与资源.md
│  └─ 里程碑.md
├─ 02-sources/
│  ├─ raw/                  # 原始文件，只读保存
│  ├─ extracted/            # 解析文本、OCR、表格抽取
│  ├─ web-snapshots/        # 联网来源快照或元数据
│  └─ source-ledger.csv     # 来源台账
├─ 03-notes/
│  ├─ 文献笔记/
│  ├─ 概念笔记/
│  └─ 冲突与边界.md
├─ 04-idea/
│  ├─ idea-v001.md
│  ├─ evaluation-v001.md
│  └─ approvals.md
├─ 05-research/
│  ├─ questions.md
│  ├─ evidence-map.md
│  ├─ literature-review.md
│  └─ gaps.md
├─ 06-blueprint/
│  ├─ paper-type.md
│  ├─ paper-blueprint.md
│  └─ experiment-plan.md
├─ 07-writing/
│  ├─ zh/
│  ├─ en/
│  └─ bilingual-map.md
├─ 08-figures/
│  ├─ source/
│  ├─ drawio/
│  └─ rendered/
├─ 09-review/
│  ├─ pre-submission/
│  ├─ reviewer-comments/
│  └─ rebuttal/
├─ 10-feedback/
│  ├─ advisor-feedback.md
│  └─ decisions.md
├─ 11-exports/
│  ├─ markdown/
│  ├─ word/
│  ├─ pdf/
│  └─ bibtex/
└─ 99-system/
   ├─ project.json
   ├─ codex-threads.json
   ├─ runs.jsonl
   ├─ approvals.jsonl
   ├─ checksums.json
   └─ versions.jsonl
```

## 4. 文件不可变规则

- `02-sources/raw/` 中的文件一经导入不得被 AI 原地修改。
- 导入时记录 SHA-256、原始文件名、大小、导入时间和来源位置。
- OCR、解析、清洗和格式转换结果写入 `extracted/`，不得覆盖 raw。
- AI 生成内容必须带 `run_id`、`thread_id`、`turn_id`、Skill 名称和生成时间。
- 正式稿采用新版本文件或版本记录，不覆盖无版本标识的已确认稿。
- 删除、移动、覆盖、外发和采用引用均进入人工确认队列。

## 5. 来源与引用状态

每条来源至少包含：

- `source_id`
- 标题、作者、年份
- URL、DOI、arXiv ID 或本地文件相对路径
- 导入或访问时间
- 原文位置：页码、章节、段落或表格
- 状态：`raw`、`metadata-verified`、`content-verified`、`conflicted`、`rejected`
- 使用位置：项目文件及段落锚点
- 人工确认人和确认时间

“未检索到”不得写成“证明不存在”；只有 `content-verified` 的内容可以直接支撑正式事实陈述。

## 6. Codex 绑定

`99-system/codex-threads.json` 记录项目主任务和各阶段子任务：

```json
{
  "primary_thread_id": null,
  "stage_threads": {},
  "desktop_uri_template": "codex://threads/{thread_id}",
  "last_verified_at": null
}
```

网页按钮只接受经过 UUID 校验的 `thread_id`，调用系统已注册的 `codex:` 协议，不拼接任意命令行参数。

## 7. 初始化验收

- 新建 Vault 不修改任何现有 Vault。
- 任意项目都能仅凭项目目录和 `99-system` 元数据恢复。
- 断开工作台后，Markdown、CSV、JSONL 和附件仍可直接阅读。
- Obsidian 插件不是读取核心研究资料的前置条件。
- 工作台只能展示真实存在的文件、来源、运行和确认状态。
