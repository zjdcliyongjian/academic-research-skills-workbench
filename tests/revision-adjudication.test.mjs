import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { finalizeRevisionInput, importRevisionRoadmap, readRevisionInput, saveRevisionDecision } from "../server/revision-adjudication.mjs";

function roadmap() {
  return {
    schema_version: "revision-roadmap/1.0",
    revision_round: 1,
    base_draft_sha256: "a".repeat(64),
    block_manifest_sha256: "b".repeat(64),
    items: [{
      id: "REV-R1-1",
      source_refs: [{ seat: "R1", channel: "finding", ordinal: 1, subclaim_ordinal: 0 }],
      description: "补充方法边界",
      reviewer: "R1",
      obligation_class: "must_fix",
      cost_scope: { kind: "section", locator: "Methods" },
      consequence_if_unaddressed: { code: "method_reproducibility_unresolved", target: { kind: "section", locator: "Methods" } },
      target_section: "Methods",
      suggested_action: "补充边界说明",
      consensus_level: "SINGLE-VERIFIER",
      verification_criteria: "方法边界可定位",
      proposed_targets: [{ block_id: "B0001", allowed_operations: ["replace_block"] }],
    }],
    total_items: 1,
    obligation_counts: { must_fix: 1, should_fix: 0, consider: 0 },
    editorial_decision: "Major Revision",
    consensus_summary: "一项必须处理的意见",
    dissenting_opinions: [],
  };
}

describe("author-owned revision adjudication", () => {
  test("does not export until every decision and explicit final words exist", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-revision-"));
    const project = { projectPath };
    let workspace = await importRevisionRoadmap(project, JSON.stringify(roadmap(), null, 2));
    expect(workspace.complete).toBe(false);
    workspace = await saveRevisionDecision(project, "REV-R1-1", {
      authorTriage: "will_address",
      authorReason: "",
      authorWords: "我同意处理这一项，并只修改 B0001。",
      authorizedTargets: [{ blockId: "B0001", allowedOperations: ["replace_block"] }],
    });
    expect(workspace.complete).toBe(true);
    expect(workspace.exportReady).toBe(false);
    workspace = await finalizeRevisionInput(project, "我确认以上裁决，并按审稿来源顺序显示。");
    expect(workspace.exportReady).toBe(true);
    const exported = JSON.parse((await readRevisionInput(project)).buffer.toString("utf8"));
    expect(exported.schema_version).toBe("author-adjudication-input/1.0");
    expect(exported.author_adjudications[0].author_triage).toBe("will_address");
    expect(exported.author_adjudications[0].authorized_targets[0].block_id).toBe("B0001");
  });

  test("refuses a target outside the immutable roadmap", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-revision-target-"));
    const project = { projectPath };
    await importRevisionRoadmap(project, JSON.stringify(roadmap()));
    await expect(saveRevisionDecision(project, "REV-R1-1", {
      authorTriage: "will_address",
      authorWords: "我要改 B9999。",
      authorizedTargets: [{ blockId: "B9999", allowedOperations: ["replace_block"] }],
    })).rejects.toThrow("超出 reviewer 提议范围");
  });
});
