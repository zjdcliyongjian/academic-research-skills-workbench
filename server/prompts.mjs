const evidenceRules = `
证据规则：
1. 项目目录中的原始资料只读，不得覆盖。
2. 逐条标注来源事实、你的综合判断、来源冲突、未知项和待核验项。
3. 不得把模型常识写成本项目已经证实的事实。
4. 当前输出是草稿，只有用户在工作台点击“采用此版本”后才能进入正式成果。
`;

export function buildPrompt(project, skillName, input = {}) {
  const base = `
项目：${project.name}
领域：${project.field}
论文类型：${project.paperType}
目标语言：${project.language}
研究目标：${project.goal}
项目根目录：${project.projectPath}
${evidenceRules}`;
  if (skillName === "idea-evaluator") {
    return `${base}
请使用 Idea Evaluator Skill 评估下面的研究构想，并严格按该 Skill 的最终结构输出。

研究构想：${input.idea || "未填写"}
每周可投入时间：${input.weeklyHours || 0} 小时
计划周期：${input.timelineMonths || 0} 个月
已有技能：${input.skills || "未填写"}
已有资源：${input.resources || "未填写"}
目标期刊或会议：${input.targetVenue || "未确定"}

请优先读取项目中的课题卡和来源台账。若来源不足，明确说明缺口，不要自行补成已验证证据。`;
  }
  return `${base}
请使用当前附加的 ${skillName} Skill 完成当前阶段草稿。

用户补充要求：${input.instructions || "按 Skill 默认流程执行"}

优先读取课题卡、来源台账、02-sources/extracted、02-sources/metadata、02-sources/evidence-cards、已采用的上游成果与冲突记录。
只有 verificationStatus=verified 的 source_fact 可以写成来源事实；pending、conflicted、rejected 必须单列，不得混入已证实结论。
若缺少真实实验数据、页码定位、图表数值或投稿格式，使用 [待补证据]、[待补实验] 或 [待作者确认]，不得推测补齐。
输出要包含可执行的下一步和需要人工确认的关键节点。`;
}
