export const PROJECT_STAGES = ["brief", "idea", "research", "blueprint", "writing", "production", "review", "export"];

const ADOPTABLE_SKILL_STAGES = new Map([
  ["vibe-research-workflow", "brief"],
  ["idea-evaluator", "idea"],
  ["deep-research", "research"],
  ["tech-paper-template", "blueprint"],
  ["benchmark-paper-template", "blueprint"],
  ["intro-drafter", "writing"],
  ["paper-writer", "writing"],
  ["paper-polish", "production"],
  ["figure-designer", "production"],
  ["drawio-reconstruction", "production"],
  ["pre-submission-reviewer", "review"],
  ["rebuttal-guidance", "review"],
]);

const NEXT_STAGE = {
  brief: "idea",
  idea: "research",
  research: "blueprint",
  blueprint: "writing",
  writing: "production",
  production: "review",
  review: "export",
};

export function stageForSkill(skillName) {
  return ADOPTABLE_SKILL_STAGES.get(skillName) || null;
}

export function nextStageAfterAdoption(stage) {
  return NEXT_STAGE[stage] || null;
}

export function downstreamStages(stage) {
  const index = PROJECT_STAGES.indexOf(stage);
  return index < 0 ? [] : PROJECT_STAGES.slice(index + 1);
}

export function advanceProjectStage(currentStage, adoptedStage) {
  const next = nextStageAfterAdoption(adoptedStage);
  if (!next) return currentStage;
  const currentIndex = PROJECT_STAGES.indexOf(currentStage);
  const nextIndex = PROJECT_STAGES.indexOf(next);
  return nextIndex > currentIndex ? next : currentStage;
}

export function assertReviewableRun(run) {
  if (!run) throw new Error("运行记录不存在");
  if (run.status !== "completed") throw new Error("只有已完成的运行结果可以审阅");
  if (!stageForSkill(run.skillName)) throw new Error("当前 Skill 尚未接入正式版本状态机");
  if (run.reviewStatus === "adopted") throw new Error("该运行结果已经采用");
  return run;
}
