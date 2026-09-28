import { describe, expect, it } from "vitest";
import { buildRunConversations, conversationForRun } from "../src/runConversation";
import type { RunRecord } from "../src/types";

const run = (id: string, parentRunId: string | null, startedAt: string, prompt: string) => ({
  id, parentRunId, startedAt, prompt, projectId: "p1", skillName: "intro-drafter", threadId: `t-${id}`,
  turnId: null, status: "completed", output: `output-${id}`, artifactPath: null, adoptedAt: null,
  cancelRequestedAt: null, reviewStatus: "pending", reviewedAt: null, reviewNote: null, completedAt: startedAt, error: null,
}) as RunRecord;

describe("persisted run conversations", () => {
  const root = run("r1", null, "2026-09-25T01:00:00.000Z", "起草引言");
  const followup = run("r2", "r1", "2026-09-25T02:00:00.000Z", "把研究缺口写具体");
  const another = run("r3", null, "2026-09-25T03:00:00.000Z", "起草方法章");

  it("restores every turn of the selected task in chronological order", () => {
    expect(conversationForRun([followup, root, another], "r2").map((item) => item.id)).toEqual(["r1", "r2"]);
  });

  it("groups follow-ups into one task and orders tasks by their latest turn", () => {
    const conversations = buildRunConversations([root, another, followup]);
    expect(conversations.map((item) => item.id)).toEqual(["r3", "r1"]);
    expect(conversations[1].turns.map((item) => item.id)).toEqual(["r1", "r2"]);
  });
});
