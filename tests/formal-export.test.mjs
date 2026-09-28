import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportMarkdown } from "../server/export.mjs";

const created = [];
afterEach(async () => { while (created.length) await rm(created.pop(), { recursive: true, force: true }); });

async function fixture() {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "research-formal-export-"));
  created.push(projectPath);
  await mkdir(path.join(projectPath, "04-idea", "versions"), { recursive: true });
  await writeFile(path.join(projectPath, "04-idea", "versions", "idea-v001.md"), "---\nstage: idea\n---\n\n# 已采用 Idea\n\n正式内容", "utf8");
  return { id: "p1", name: "可信导出", field: "AI", goal: "只导出正式版本", paperType: "technical", projectPath };
}

describe("阶段 1.5 正式导出边界", () => {
  it("没有正式版本时拒绝用已完成草稿自动补位", async () => {
    const project = await fixture();
    const runs = [{ id: "draft-run", status: "completed", skillName: "deep-research", output: "不应进入正式导出", reviewStatus: "pending" }];
    await expect(exportMarkdown(project, [], [], runs, "zh", { mode: "formal" })).rejects.toThrow("尚无人工采用的正式版本");
  });

  it("正式导出只读取 active 版本并写入溯源信息", async () => {
    const project = await fixture();
    const versions = [{
      id: "version-1", projectId: "p1", stage: "idea", versionNumber: 1,
      runId: "adopted-run", skillName: "idea-evaluator",
      relativePath: "04-idea/versions/idea-v001.md", contentSha256: "abc123",
      status: "active", adoptedAt: "2026-09-15T02:00:00.000Z",
    }];
    const runs = [{ id: "draft-run", status: "completed", skillName: "deep-research", output: "未采用草稿内容", reviewStatus: "pending" }];
    const target = await exportMarkdown(project, [], versions, runs, "zh", { mode: "formal" });
    const body = await readFile(target, "utf8");
    expect(body).toContain("正式内容");
    expect(body).toContain("version-1");
    expect(body).not.toContain("未采用草稿内容");
    expect(path.basename(target)).toContain("FORMAL");
  });

  it("只有显式 draft 模式才导出草稿并加醒目标识", async () => {
    const project = await fixture();
    const runs = [{ id: "draft-run", status: "completed", skillName: "deep-research", output: "草稿正文", reviewStatus: "pending" }];
    const target = await exportMarkdown(project, [], [], runs, "zh", { mode: "draft", runId: "draft-run" });
    const body = await readFile(target, "utf8");
    expect(path.basename(target)).toContain("DRAFT");
    expect(body).toContain("未经人工采用");
    expect(body).toContain("草稿正文");
  });
});
