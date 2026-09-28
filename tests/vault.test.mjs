import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertInside, createProjectSpace, safeSegment, saveSourceFile, saveStageVersion } from "../server/vault.mjs";
import { SKILL_REGISTRY } from "../server/config.mjs";

const created = [];
afterEach(async () => { while (created.length) await rm(created.pop(), { recursive: true, force: true }); });

describe("科研 Vault 边界", () => {
  it("清理不安全目录字符", () => expect(safeSegment('课题:A/B*?')).toBe("课题-A-B"));
  it("拒绝越出 Vault 的路径", () => expect(() => assertInside("C:\\vault", "C:\\other\\file")).toThrow());
  it("创建完整课题骨架并保存带哈希的原始资料", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "research-vault-")); created.push(root);
    const project = { id: "p001", name: "可追溯研究", field: "AI", goal: "验证资料边界", paperType: "technical", language: "zh", createdAt: new Date().toISOString() };
    const projectPath = await createProjectSpace(root, project);
    const saved = await saveSourceFile({ ...project, projectPath }, "paper.md", Buffer.from("source"));
    expect(saved.sha256).toHaveLength(64);
    expect(await readFile(path.join(projectPath, saved.relativePath), "utf8")).toBe("source");
    expect(await readFile(path.join(projectPath, "02-sources", "source-ledger.csv"), "utf8")).toContain("source_id");
    expect(await readFile(path.join(projectPath, "05-research", "reviews.jsonl"), "utf8")).toBe("");
    const version = await saveStageVersion({ ...project, projectPath }, { id: "run-12345678", skillName: "deep-research", output: "# 已确认调研" }, "research", 1, "2026-09-15T02:00:00.000Z");
    expect(version.contentSha256).toHaveLength(64);
    expect(await readFile(path.join(projectPath, version.relativePath), "utf8")).toContain("status: active");
  });
});

describe("科研 Skill 注册表", () => {
  it("12 个 Skill 均提供完整、唯一的界面说明", () => {
    expect(SKILL_REGISTRY).toHaveLength(12);
    expect(new Set(SKILL_REGISTRY.map((skill) => skill.name)).size).toBe(12);
    for (const skill of SKILL_REGISTRY) {
      expect(skill.label).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.input).toBeTruthy();
      expect(skill.output).toBeTruthy();
      expect(skill.gate).toBeTruthy();
      expect(["阶段 1", "阶段 2", "阶段 3"]).toContain(skill.deliveryStage);
    }
  });
});
