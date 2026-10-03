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
    path.join(os.homedir(), "ARSCodexResearchVault"),
);

export const SKILL_REGISTRY = [
  {
    name: "ars-scope", runtimeSkill: "academic-research-suite", route: "deep-research · socratic", label: "范围界定", stage: "brief", category: "foundation", deliveryStage: "阶段 0",
    description: "把宽泛主题收敛成可研究的问题、边界、约束与成功标准；研究问题不清楚时先走苏格拉底式澄清。",
    input: "研究主题、目标读者、已知约束、已有材料与预期成果",
    output: "范围卡、研究问题候选、缺失输入与下一检查点",
    gate: "研究问题与边界必须由作者确认",
  },
  {
    name: "ars-research", runtimeSkill: "academic-research-suite", route: "deep-research", label: "深度调研", stage: "idea", category: "foundation", deliveryStage: "阶段 1",
    description: "围绕已确认问题组织检索、来源核验、证据综合、争议与研究缺口，不把搜索结果直接当作已读全文。",
    input: "已确认问题、来源范围、时间边界、可联网范围与本地材料",
    output: "证据地图、来源台账、综合报告、冲突与未知项",
    gate: "引用、全文读取状态和关键判断采用前由作者核验",
  },
  {
    name: "ars-write", runtimeSkill: "academic-research-suite", route: "academic-paper", label: "论文写作", stage: "research", category: "foundation", deliveryStage: "阶段 2",
    description: "从规划、提纲到章节草稿逐步推进论文，严格区分真实结果、计划、推论与待补证据。",
    input: "已确认研究问题、证据、方法/实验材料、目标体例与写作范围",
    output: "论文计划、结构提纲、章节草稿或双语摘要",
    gate: "结构、贡献表述、引用与事实变化逐项由作者确认",
  },
  {
    name: "ars-integrity", runtimeSkill: "academic-research-suite", route: "academic-pipeline · Stage 2.5", label: "完整性核验Ⅰ", stage: "blueprint", category: "production", deliveryStage: "阶段 2.5",
    description: "在进入同行评审前执行第一道完整性门：检查声明—引用对齐、来源存在性、证据边界与关键缺口。",
    input: "当前稿件、引用、证据台账、声明登记表与核验范围",
    output: "完整性报告、阻断项、降级项与可追溯核验记录",
    gate: "默认只读；程序化引文核验和外部 API 仅在明确授权后运行",
  },
  {
    name: "ars-review", runtimeSkill: "academic-research-suite", route: "academic-paper-reviewer · full", label: "同行评审", stage: "writing", category: "production", deliveryStage: "阶段 3",
    description: "以同一份原始稿件和作者确认的标准执行多视角审查，保留不同意见并形成编辑决定信。",
    input: "待审稿件、学科、目标 venue/track、贡献类型与审查重点",
    output: "分级审稿意见、证据定位、编辑决定与返修路线",
    gate: "审查默认只读；目标期刊和采用标准必须由作者确认",
  },
  {
    name: "ars-revise", runtimeSkill: "academic-research-suite", route: "academic-paper · revision", label: "返修与复审", stage: "production", category: "review", deliveryStage: "阶段 4",
    description: "把审稿意见转成非排名返修路线，只有作者裁决为 will_address 的项目才进入修改，并支持复审闭环。",
    input: "编辑决定信、原稿、作者逐项裁决、补充证据与修改边界",
    output: "返修路线、修改稿、逐条回复、复审结论与残余风险",
    gate: "系统不得替作者推断或自动应用返修决定",
  },
  {
    name: "ars-finalize", runtimeSkill: "academic-research-suite", route: "academic-pipeline · Stage 4.5", label: "最终核验与定稿", stage: "review", category: "review", deliveryStage: "阶段 4.5",
    description: "在正式交付前复核声明强度、引用与版本变化，完成最终完整性门、定稿和过程总结。",
    input: "最终候选稿、返修记录、引用、Material Passport 与交付要求",
    output: "最终核验报告、定稿候选、过程摘要与未解决限制",
    gate: "未通过阻断项时不得标记为正式定稿；最终提交仍由作者完成",
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
