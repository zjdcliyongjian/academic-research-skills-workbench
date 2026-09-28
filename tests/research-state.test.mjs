import { describe, expect, it } from "vitest";
import {
  advanceProjectStage,
  assertReviewableRun,
  downstreamStages,
  nextStageAfterAdoption,
  stageForSkill,
} from "../server/research-state.mjs";

describe("阶段 2 全生命周期研究状态机", () => {
  it("把可采用 Skill 映射到正确研究阶段", () => {
    expect(stageForSkill("idea-evaluator")).toBe("idea");
    expect(stageForSkill("deep-research")).toBe("research");
    expect(stageForSkill("tech-paper-template")).toBe("blueprint");
    expect(stageForSkill("benchmark-paper-template")).toBe("blueprint");
    expect(stageForSkill("intro-drafter")).toBe("writing");
    expect(stageForSkill("paper-writer")).toBe("writing");
    expect(stageForSkill("paper-polish")).toBe("production");
    expect(stageForSkill("figure-designer")).toBe("production");
    expect(stageForSkill("drawio-reconstruction")).toBe("production");
    expect(stageForSkill("pre-submission-reviewer")).toBe("review");
    expect(stageForSkill("rebuttal-guidance")).toBe("review");
  });

  it("只有采用结果才向后推进且不会让项目倒退", () => {
    expect(nextStageAfterAdoption("idea")).toBe("research");
    expect(advanceProjectStage("idea", "idea")).toBe("research");
    expect(advanceProjectStage("research", "research")).toBe("blueprint");
    expect(advanceProjectStage("blueprint", "blueprint")).toBe("writing");
    expect(advanceProjectStage("writing", "writing")).toBe("production");
    expect(advanceProjectStage("production", "production")).toBe("review");
    expect(advanceProjectStage("review", "review")).toBe("export");
    expect(advanceProjectStage("export", "idea")).toBe("export");
  });

  it("识别所有需要复核的下游阶段", () => {
    expect(downstreamStages("idea")).toEqual(["research", "blueprint", "writing", "production", "review", "export"]);
    expect(downstreamStages("research")).toEqual(["blueprint", "writing", "production", "review", "export"]);
  });

  it("拒绝审阅未完成、已采用或未接入的运行", () => {
    expect(() => assertReviewableRun({ status: "running", skillName: "idea-evaluator", reviewStatus: "pending" })).toThrow("只有已完成");
    expect(() => assertReviewableRun({ status: "completed", skillName: "idea-evaluator", reviewStatus: "adopted" })).toThrow("已经采用");
    expect(() => assertReviewableRun({ status: "completed", skillName: "unknown-skill", reviewStatus: "pending" })).toThrow("尚未接入");
  });
});

