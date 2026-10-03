import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMaterialPassport, syncMaterialPassport, WORKBENCH_PASSPORT_SCHEMA } from "../server/material-passport.mjs";

function fixture(projectPath) {
  const project = {
    id: "project-1", name: "证据边界测试", field: "HCI", goal: "验证 Passport 投影",
    stage: "research", status: "active", language: "zh", paperType: "technical",
    projectPath, threadId: "thread-1", createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T01:00:00.000Z",
  };
  const sources = [{
    id: "source-1", name: "paper.pdf", kind: "file", relativePath: "02-sources/raw/paper.pdf", url: null,
    sha256: "a".repeat(64), status: "content-verified", processingStatus: "content_verified",
    title: "A paper", authors: ["A"], publicationYear: 2026, venue: "Test", doi: null,
  }];
  const evidenceClaims = [{
    id: "claim-1", sourceId: "source-1", claimType: "source_fact", claimText: "可定位事实",
    locator: "p. 3", quoteSha256: "b".repeat(64), verificationStatus: "verified", verifiedAt: "2026-09-28T00:30:00.000Z", note: null,
  }];
  const runs = [{
    id: "run-1", skillName: "ars-write", status: "completed", reviewStatus: "pending", parentRunId: null,
    artifactPath: "05-research/drafts/run-1.md", startedAt: "2026-09-28T00:10:00.000Z", completedAt: "2026-09-28T00:20:00.000Z",
    reviewedAt: null, reviewNote: null,
  }];
  const versions = [{
    id: "version-1", stage: "research", versionNumber: 1, runId: "run-1", skillName: "ars-write",
    relativePath: "05-research/versions/v1.md", contentSha256: "c".repeat(64), status: "active",
    adoptedAt: "2026-09-28T00:40:00.000Z", supersededAt: null,
  }];
  return { project, sources, evidenceClaims, runs, versions, approvals: [] };
}

describe("Material Passport workbench projection", () => {
  it("keeps evidence boundaries explicit and never infers human reading", () => {
    const input = fixture("C:/vault/project-1");
    const passport = buildMaterialPassport({
      ...input,
      ledger: { status: "missing", entries: 0, backed: 0, awaiting_answer: [], cannot_confirm: [], not_run: [], missing: [], counters: {} },
      generatedAt: "2026-09-28T02:00:00.000Z",
    });
    expect(passport.schema_version).toBe(WORKBENCH_PASSPORT_SCHEMA);
    expect(passport.projection_scope).toBe("WORKBENCH_PROJECTION");
    expect(passport.provenance.verification_status).toBe("UNVERIFIED");
    expect(passport.literature_corpus_projection[0].human_read_status).toBe("not_recorded");
    expect(passport.author_checkpoints[0].status).toBe("open");
    expect(passport.boundaries.join(" ")).toContain("不声称符合上游 Material Passport Schema 9");
  });

  it("writes a structured passport even when the optional ledger runtime is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ars-passport-test-"));
    const input = fixture(root);
    const { passport, path: passportPath } = await syncMaterialPassport(input);
    const stored = JSON.parse(await readFile(passportPath, "utf8"));
    expect(stored.schema_version).toBe(WORKBENCH_PASSPORT_SCHEMA);
    expect(stored.projection_sha256).toBe(passport.projection_sha256);
    expect(["missing", "unavailable", "ok"]).toContain(stored.run_ledger.status);
  });
});
