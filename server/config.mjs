import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = path.resolve(serverDir, "..");
export const DATA_DIR = path.resolve(process.env.AI_RESEARCH_DATA_DIR || path.join(APP_ROOT, "data"));
export const DIST_DIR = path.join(APP_ROOT, "dist");
export const PORT = Number(process.env.AI_RESEARCH_PORT || 4317);
export const HOST = "127.0.0.1";
export const DEFAULT_VAULT_ROOT = path.resolve(
  process.env.AI_RESEARCH_VAULT_ROOT ||
    path.join(os.homedir(), "AIResearchCopilotVault"),
);

export const SKILL_REGISTRY = [
  {
    name: "vibe-research-workflow", label: "研究工作流", stage: "brief", category: "foundation", deliveryStage: "阶段 1",
    description: "判断课题当前所处阶段，把模糊研究目标拆成可执行工作流，并提醒工具选择与研究红线。",
    input: "当前阶段、研究目标、现有资料与可用工具",
    output: "阶段判断、任务路线、工具建议与红线提醒",
    gate: "由你确认是否进入下一研究阶段",
  },
  {
    name: "idea-evaluator", label: "Idea 评估", stage: "idea", category: "foundation", deliveryStage: "阶段 1",
    description: "在投入完整调研前审视研究想法，识别致命缺陷、创新空间、资源匹配和完成概率。",
    input: "研究构想、时间投入、已有技能、资源与投稿目标",
    output: "缺陷审计、五维评分、可行性分析与结论",
    gate: "由你决定接受、修改后重评、暂缓或终止",
  },
  {
    name: "deep-research", label: "深度文献调研", stage: "research", category: "foundation", deliveryStage: "阶段 1",
    description: "围绕已确认的研究问题检索和综合证据，梳理研究格局、争议、反例与真正空白。",
    input: "研究问题、本地资料、检索边界与联网范围",
    output: "综述级证据报告、争议、研究缺口与引用线索",
    gate: "引用和关键结论采用前由你核验",
  },
  {
    name: "tech-paper-template", label: "技术论文蓝图", stage: "blueprint", category: "foundation", deliveryStage: "阶段 1",
    description: "把技术问题、方法和实验设计组织成一条完整论文论证链，提前暴露结构与证据缺口。",
    input: "技术问题、候选方法、实验计划与预期贡献",
    output: "论文逻辑、章节骨架、方法纲要与一致性检查",
    gate: "蓝图通过确认后才进入正式写作",
  },
  {
    name: "benchmark-paper-template", label: "Benchmark 论文蓝图", stage: "blueprint", category: "foundation", deliveryStage: "阶段 1",
    description: "面向数据集、评测或基准论文，检查问题定义、数据构建、指标和实验协议是否完整。",
    input: "评测对象、数据构建、指标维度与实验框架",
    output: "五支柱完整性检查、引言逻辑与章节骨架",
    gate: "数据授权、评测公平性和蓝图由你确认",
  },
  {
    name: "intro-drafter", label: "引言起草", stage: "writing", category: "production", deliveryStage: "阶段 2",
    description: "依据已确认的研究动机、现有缺陷和贡献，起草递进清晰的论文 Introduction。",
    input: "研究动机、现有工作缺陷、方法、挑战与贡献",
    output: "六段式引言正文、论证链与引用占位",
    gate: "引文和贡献表述需由你确认",
  },
  {
    name: "paper-writer", label: "论文写作", stage: "writing", category: "production", deliveryStage: "阶段 2",
    description: "基于已确认蓝图、证据和真实实验结果撰写论文正文，不用推测补齐缺失事实。",
    input: "已确认蓝图、来源证据、实验结果和写作要求",
    output: "有证据约束的章节正文与待补项",
    gate: "每章采用后才进入正式稿",
  },
  {
    name: "paper-polish", label: "论文润色", stage: "production", category: "production", deliveryStage: "阶段 2",
    description: "改善学术表达、逻辑衔接和语言准确性，同时标出可能改变原意的高风险修改。",
    input: "已有正文、目标语言、期刊风格与不可改动项",
    output: "忠于原意的润色稿与语义风险清单",
    gate: "含义可能变化的修改逐项确认",
  },
  {
    name: "figure-designer", label: "科研图表设计", stage: "production", category: "production", deliveryStage: "阶段 2",
    description: "把论文中的比较、流程或机制转成清晰图表方案，检查数据、标注和阅读顺序。",
    input: "图表意图、真实数据、论文位置与版面限制",
    output: "图表类型、布局、标注、制作工具与检查清单",
    gate: "图意、数据和标注由你确认",
  },
  {
    name: "drawio-reconstruction", label: "Draw.io 重建", stage: "production", category: "production", deliveryStage: "阶段 2",
    description: "根据参考图或截图重建可继续编辑的 Draw.io 图，并提供预览和视觉差异检查。",
    input: "参考图片、结构说明、尺寸和可编辑要求",
    output: "可编辑 Draw.io 文件、PNG 预览与审计结果",
    gate: "由你进行结构和视觉验收",
  },
  {
    name: "pre-submission-reviewer", label: "投稿前审查", stage: "review", category: "review", deliveryStage: "阶段 3",
    description: "在投稿前从论证、方法、实验、写作和格式等维度发现问题，并按严重程度排序。",
    input: "完整论文、目标期刊或会议及格式要求",
    output: "分级问题清单、评分、修订顺序与投稿建议",
    gate: "只提出审查意见，由你决定修改和投稿",
  },
  {
    name: "rebuttal-guidance", label: "审稿回应", stage: "review", category: "review", deliveryStage: "阶段 3",
    description: "拆解审稿意见，规划逐问题回应、补充证据和语气策略，不代替作者作无法证明的承诺。",
    input: "审稿意见、论文证据、实验限制与回复期限",
    output: "逐条回应策略、证据指针、补实验建议与措辞提示",
    gate: "由你编写、确认并提交正式回复",
  },
];

export const ALLOWED_SOURCE_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".md",
  ".txt",
  ".csv",
]);

export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
