import { SKILL_REGISTRY } from "../server/config.mjs";
import { stageForSkill } from "../server/research-state.mjs";

const skillGuidance = {
  "ars-scope": "以苏格拉底式提问收敛研究问题、边界、约束和成功标准。问题未收敛前不替作者生成最终研究问题。",
  "ars-research": "围绕已确认问题整理来源、证据、争议和缺口；明确全文读取状态，不把检索结果当作已核验全文。",
  "ars-write": "按 plan、outline、draft 或 abstract 的明确范围写作，严格区分来源事实、计划、推论和真实结果。",
  "ars-integrity": "以只读方式执行 Stage 2.5 完整性检查，核对声明—引用对齐、来源存在性、证据强度和阻断项。",
  "ars-review": "以作者确认的审查目标执行只读同行评审，保留不同意见，形成可定位的分级问题和编辑决定。",
  "ars-revise": "先形成作者可裁决的返修路线，只处理明确授权为 will_address 的项目，并保留逐条回复和残余风险。",
  "ars-finalize": "执行 Stage 4.5 最终完整性核验，阻断项未关闭时停止定稿并列出作者待办。",
  // Legacy guidance remains for historical cloud runs.
  "vibe-research-workflow": "判断研究阶段，输出阶段目标、六个月以内的分阶段路线、每阶段输入/任务/输出/验收门槛、未来两周清单、暂停事项和人工决策点。",
  "idea-evaluator": "完成致命缺陷审计、创新性/重要性/可行性/资源匹配/完成概率评分，给出继续、修改后重评、暂缓或终止结论。",
  "deep-research": "只基于提供的来源与证据梳理研究格局、方法比较、冲突、反例、空白和待核验引用。不得声称已联网检索未提供的资料。",
  "tech-paper-template": "建立技术论文的问题—方法—实验—贡献论证链，输出章节骨架、证据需求和一致性检查。",
  "benchmark-paper-template": "按问题定义、数据、指标、协议、分析五支柱建立 Benchmark 论文蓝图，并检查授权、公平性和泄漏风险。",
  "intro-drafter": "根据已采用蓝图起草递进式引言；所有未核验引文用明确占位符，贡献表述不得超过证据。",
  "paper-writer": "按指定章节写作，引用只使用已核验来源事实；缺少实验、数值或方法细节时保留待补项。",
  "paper-polish": "改善表达、衔接和学术语气，不新增事实；单列可能改变原意的修改和需作者确认项。",
  "figure-designer": "输出图表目的、数据字段、编码方式、布局、标注、无障碍与验收清单；没有真实数据时不得生成虚构数值。",
  "drawio-reconstruction": "基于已提供的结构说明生成可编辑图的重建规格；缺少参考图或尺寸时只输出缺口，不伪造重建结果。",
  "pre-submission-reviewer": "从论证、方法、实验、写作、伦理与格式分级审查，输出 Critical/Major/Minor 问题、证据位置和修订顺序。",
  "rebuttal-guidance": "逐条拆解审稿意见，区分同意/澄清/补证据/补实验/礼貌反驳，禁止承诺无法完成或无法证明的事项。",
};

export const CLOUD_SKILLS = SKILL_REGISTRY.map((item) => ({ ...item, found: true, enabled: true, path: null }));

export function getSkill(name) {
  const skill = CLOUD_SKILLS.find((item) => item.name === name);
  if (!skill) throw new Error("该科研 Skill 尚未接入云端模型执行器");
  return skill;
}

export function currentRunMessage(skillName, input = {}) {
  const explicit = String(input.message || "").trim();
  if (explicit) return explicit;
  if (skillName === "idea-evaluator") return String(input.idea || "").trim() || "评估当前研究构想";
  return String(input.instructions || "").trim() || "按当前 Skill 的标准流程形成可审阅草稿";
}

export function appendConversationTurn(input = {}, run, message) {
  const existing = Array.isArray(input.conversation) ? input.conversation : [];
  const turn = {
    user: String(run?.prompt || "").slice(0, 4_000),
    assistant: String(run?.output || "").slice(0, 20_000),
  };
  return { ...input, message: String(message || "").trim(), conversation: [...existing, turn].slice(-8) };
}

export function buildCloudPrompt({ project, skillName, input = {}, sources = [], evidenceClaims = [], versions = [] }) {
  const skill = getSkill(skillName);
  const verifiedSources = sources.filter((item) => item.status === "content-verified");
  const facts = evidenceClaims.filter((item) => (item.claimType || item.claim_type) === "source_fact" && (item.verificationStatus || item.verification_status) === "verified");
  const unresolved = evidenceClaims.filter((item) => ["pending", "conflicted"].includes(item.verificationStatus || item.verification_status));
  const activeVersions = versions.filter((item) => item.status === "active");
  const sourceDigest = verifiedSources.slice(0, 20).map((item, index) =>
    `[S${index + 1}] ${item.title || item.name}\nURL/文件：${item.url || item.blob_url || "私有文件"}\n正文摘录：${String(item.extracted_text || "").slice(0, 5000)}`
  ).join("\n\n");
  const factDigest = facts.slice(0, 80).map((item) => `- ${item.claimText || item.claim_text}${item.locator ? `（定位：${item.locator}）` : ""}`).join("\n");
  const versionDigest = activeVersions.map((item) => `## 已采用${item.stage}版本 v${item.version_number}\n${String(item.content || "").slice(0, 12000)}`).join("\n\n");
  const taskContext = skillName === "idea-evaluator"
    ? `研究构想：${input.idea || "未填写"}\n每周投入：${input.weeklyHours || 0}小时\n计划周期：${input.timelineMonths || 0}个月\n已有技能：${input.skills || "未填写"}\n已有资源：${input.resources || "未填写"}\n目标期刊/会议：${input.targetVenue || "未确定"}`
    : "";
  const conversationDigest = (Array.isArray(input.conversation) ? input.conversation : []).slice(-6).map((turn, index) =>
    `### 历史第 ${index + 1} 轮\n用户：${String(turn.user || "").slice(0, 4_000)}\n工作台：${String(turn.assistant || "").slice(0, 12_000)}`
  ).join("\n\n");
  const userRequirements = currentRunMessage(skillName, input);

  return {
    system: `你是“AI科研工作台”的服务器端科研 Skill 执行器。当前 Skill：${skill.label}（${skill.name}）。\n${skillGuidance[skill.name]}\n\n必须遵守：\n1. 严格区分来源事实、综合判断、推断、冲突和未知项。\n2. 不得把模型常识、未经核验的网页元数据或推测写成项目事实。\n3. 不得虚构实验、样本、数值、引文、DOI、页码、图表或投稿状态。\n4. 缺失内容用[待补证据]、[待补实验]、[待作者确认]标记。\n5. 输出是待审阅草稿，只有用户点击“采用此版本”后才进入正式版本。\n6. 结尾必须给出“人工确认清单”和“下一步”。\n7. 使用 Markdown，中文清晰、可执行。`,
    user: `课题：${project.name}\n领域：${project.field}\n论文类型：${project.paper_type}\n输出语言：${project.language}\n研究目标：${project.goal}\n当前阶段：${project.stage}${taskContext ? `\n\n任务基础参数：\n${taskContext}` : ""}${conversationDigest ? `\n\n已保存的多轮对话：\n${conversationDigest}` : ""}\n\n本轮用户要求：\n${userRequirements}\n\n已核验来源（仅这些可作为来源事实）：\n${sourceDigest || "暂无内容已核验的来源。所有事实性结论必须标注为待核验。"}\n\n已核验来源事实证据卡：\n${factDigest || "暂无。"}\n\n仍待核验或冲突的证据数量：${unresolved.length}\n\n已采用的上游版本：\n${versionDigest || "暂无。"}`,
    stage: stageForSkill(skillName),
  };
}
