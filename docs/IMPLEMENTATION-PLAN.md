# 实施计划

## Phase 0 — 已确认基线

- 独立仓库，不修改原 Supervisor-Skills 工作台。
- 复用其本地项目、来源证据、运行、人工采用和导出基础设施。
- 上游 ARS 作为外部 Skill 安装，不复制进本仓库。

## Phase 1 — 本地 MVP

- 7 个逻辑能力到 `academic-research-suite` 的适配层。
- ARS 阶段状态机、人工门、版本与下游失效。
- Material Passport 状态页与本地目录。
- 4.0 视觉改版、README、许可证和第三方声明。
- 类型检查、自动化测试、构建、健康检查与 Chrome 渲染验收。

## Phase 2 — 深化（已完成）

- [x] 使用 ARS 自带 `run_ledger.py` 写入初始指令、运行收据、文件哈希、工具审批和作者采用检查点。
- [x] 落盘 `ars-workbench-material-passport/1.0` 工作台投影，并明确标注它不冒充上游 Schema 9。
- [x] Passport 状态页显示收据链健康、开放检查点、Claim Registry、版本登记和真实边界。
- [x] 上游 Schema 9 JSON 原文隔离导入/导出、核心兼容检查和已支持子合约检查；不把工作台投影冒充为 Schema 9。
- [x] Claim Registry 结构化编辑、来源事实强制正文核验与定位字段。
- [x] `revision-roadmap/1.0` 导入、逐项作者裁决、原话哈希与 `author-adjudication-input/1.0` 导出。
- [x] Stage 2.5 / 4.5 专用核验报告视图；运行完成不自动等于 PASS。
- [x] PDF page-anchor preflight、项目本地引用核验缓存和逐次明确授权的程序化验证入口。

Phase 2 的边界：Schema 9 当前接受 JSON，并验证核心字段、`repro_lock` 与已接通的 `literature_corpus` 子合约；未知扩展保持未验证。程序化书目核验使用合成 `ref_slug`，只提供诊断，不能替代真实稿件 prose join 或人工最终确认。

## Phase 3 — 可选扩展

- 明确同意后的 cross-model 检查。
- 实验 Agent 的运行环境、资源隔离与结果回写。
- 团队/云端版本；需要单独处理保密、成本、并发、合规和 CC BY-NC 商业边界。
- Schema 9 YAML 与更多可选扩展合约的兼容验证。
- 把真实稿件引用位置绑定到上游 `ref_slug` 的完整 prose join。
