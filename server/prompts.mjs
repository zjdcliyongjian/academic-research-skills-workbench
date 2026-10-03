import { SKILL_REGISTRY } from "./config.mjs";

const evidenceRules = `
证据规则：
1. 项目目录中的原始资料只读，不得覆盖。
2. 逐条标注来源事实、你的综合判断、来源冲突、未知项和待核验项。
3. 不得把模型常识写成本项目已经证实的事实。
4. 当前输出是草稿，只有用户在工作台点击“采用此版本”后才能进入正式成果。
5. 不得编造引用、实验、审稿结论、伦理审批或机构授权。
6. 默认使用简体中文；保留 DOI、术语、路径和代码的原始形式。
`;

const routeInstructions = {
  "ars-scope": "选择 deep-research workflow 的 socratic 模式。当前只做范围界定和研究问题澄清；若问题尚未收敛，不得替用户生成最终研究问题。",
  "ars-research": "选择 deep-research workflow。根据任务判断是 full、literature-review 或其他明确模式；先说明模式、输入与检查点。",
  "ars-write": "选择 academic-paper workflow。根据用户要求执行 plan、outline、draft、abstract 或其他明确模式；只处理本轮要求的写作范围。",
  "ars-integrity": "选择 academic-pipeline workflow 的 Stage 2.5 完整性检查。默认只读；除非用户明确要求程序化验证，否则使用工作台证据与正常浏览核验，不启动 bibliographic Python resolver。",
  "ars-review": "选择 academic-paper-reviewer workflow 的 full 模式。审稿默认只读；不得修改稿件或虚构 reviewer 独立性。",
  "ars-revise": "选择 academic-paper workflow 的 revision-coach / revision 流程，并在需要时进入 re-review。只修改作者明确裁决为 will_address 的项目。",
  "ars-finalize": "选择 academic-pipeline workflow 的 Stage 4.5，执行最终完整性核验、finalize 与 process summary；若存在阻断项必须显式停止。",
};

export function buildPrompt(project, skillName, input = {}) {
  const skill = SKILL_REGISTRY.find((item) => item.name === skillName);
  if (!skill) throw new Error(`未知 ARS 工作台能力：${skillName}`);
  const base = `
项目：${project.name}
领域：${project.field}
论文类型：${project.paperType}
目标语言：${project.language}
研究目标：${project.goal}
项目根目录：${project.projectPath}
${evidenceRules}`;
  return `${base}
请调用当前附加的 $academic-research-suite，并严格遵守它的路由、安全边界和人工检查点。

工作台能力：${skill.label}
ARS 路由：${skill.route}
路由要求：${routeInstructions[skillName]}

用户补充要求：${input.instructions || "按 Skill 默认流程执行"}

优先读取课题卡、来源台账、02-sources/extracted、02-sources/metadata、02-sources/evidence-cards、已采用的上游成果与冲突记录。
只有 verificationStatus=verified 的 source_fact 可以写成来源事实；pending、conflicted、rejected 必须单列，不得混入已证实结论。
若缺少真实实验数据、页码定位、图表数值或投稿格式，使用 [待补证据]、[待补实验] 或 [待作者确认]，不得推测补齐。
输出开头必须列出：当前 ARS 阶段、所需输入、本轮产物、下一道检查点及其是否强制。
输出结尾必须列出：已验证事实、综合判断、未知/冲突、需要作者确认、下一步。
如果任务跨越多个阶段，只执行本工作台能力对应的阶段，并把后续阶段写成待办，不得静默越过人工门。`;
}
