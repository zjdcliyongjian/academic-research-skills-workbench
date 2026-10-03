import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRetryPrompt, RETRY_NOTE } from "../server/run-prompts.mjs";

const isolatedData = await mkdtemp(path.join(os.tmpdir(), "codex-thread-recovery-"));
process.env.AI_RESEARCH_DATA_DIR = isolatedData;
process.env.AI_RESEARCH_VAULT_ROOT = path.join(isolatedData, "vault");
const { CodexBridge } = await import("../server/codex-bridge.mjs");
const { db: isolatedDatabase } = await import("../server/db.mjs");
afterAll(async () => {
  isolatedDatabase.close();
  await rm(isolatedData, { recursive: true, force: true });
});

function mockStore() {
  const runs = new Map();
  return {
    updateProjectThread: vi.fn((id, threadId) => ({ id, name: "测试课题", projectPath: "D:\\\\vault\\\\p1", threadId })),
    getRun: vi.fn((id) => runs.get(id) || { id, status: "queued", cancelRequestedAt: null }),
    updateRun: vi.fn((id, patch) => {
      const updated = { ...(runs.get(id) || { id, status: "queued", cancelRequestedAt: null }), ...patch };
      runs.set(id, updated);
      return updated;
    }),
  };
}

function bridgeWith(storeInstance, updateBinding = vi.fn(async () => {})) {
  const bridge = new CodexBridge({ storeInstance, updateBinding });
  bridge.start = vi.fn(async () => { bridge.ready = true; });
  bridge.skillMap.set("vibe-research-workflow", { name: "vibe-research-workflow", enabled: true, path: "D:\\\\skills\\\\workflow\\\\SKILL.md" });
  return { bridge, updateBinding };
}

const project = {
  id: "p1",
  name: "测试课题",
  projectPath: "D:\\vault\\p1",
  threadId: "thread-old",
};

describe("Codex 任务恢复", () => {
  it("有历史 thread ID 时先 resume，再启动 turn", async () => {
    const storeInstance = mockStore();
    const { bridge } = bridgeWith(storeInstance);
    const methods = [];
    bridge.request = vi.fn(async (method) => {
      methods.push(method);
      if (method === "thread/resume") return { thread: { id: "thread-old" } };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw new Error(`unexpected ${method}`);
    });

    const result = await bridge.startSkill({ runId: "run-1", project, skillName: "vibe-research-workflow", prompt: "test" });

    expect(methods).toEqual(["thread/resume", "turn/start"]);
    expect(result).toEqual({ threadId: "thread-old", turnId: "turn-1" });
    expect(storeInstance.updateProjectThread).not.toHaveBeenCalled();
    expect(storeInstance.updateRun).toHaveBeenLastCalledWith("run-1", { threadId: "thread-old", turnId: "turn-1", status: "running" });
  });

  it("resume 确认任务不存在时创建新任务并重绑项目与运行", async () => {
    const storeInstance = mockStore();
    const { bridge, updateBinding } = bridgeWith(storeInstance);
    bridge.request = vi.fn(async (method) => {
      if (method === "thread/resume") throw new Error("thread/resume: thread not found: thread-old");
      if (method === "thread/start") return { thread: { id: "thread-new" } };
      if (method === "thread/name/set") return {};
      if (method === "turn/start") return { turn: { id: "turn-new" } };
      throw new Error(`unexpected ${method}`);
    });

    const result = await bridge.startSkill({ runId: "run-2", project, skillName: "vibe-research-workflow", prompt: "test" });

    expect(result).toEqual({ threadId: "thread-new", turnId: "turn-new" });
    expect(storeInstance.updateProjectThread).toHaveBeenCalledWith("p1", "thread-new");
    expect(updateBinding).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-new" }), "thread-new");
    expect(storeInstance.updateRun).toHaveBeenCalledWith("run-2", { threadId: "thread-new" });
    expect(storeInstance.updateRun).toHaveBeenLastCalledWith("run-2", { threadId: "thread-new", turnId: "turn-new", status: "running" });
  });

  it("新版 Codex 返回 no rollout found 时同样创建新任务并继续", async () => {
    const storeInstance = mockStore();
    const { bridge, updateBinding } = bridgeWith(storeInstance);
    bridge.request = vi.fn(async (method) => {
      if (method === "thread/resume") throw new Error("thread/resume: no rollout found for thread id thread-old");
      if (method === "thread/start") return { thread: { id: "thread-new-rollout" } };
      if (method === "thread/name/set") return {};
      if (method === "turn/start") return { turn: { id: "turn-new-rollout" } };
      throw new Error(`unexpected ${method}`);
    });

    const result = await bridge.startSkill({ runId: "run-rollout", project, skillName: "vibe-research-workflow", prompt: "test" });

    expect(result).toEqual({ threadId: "thread-new-rollout", turnId: "turn-new-rollout" });
    expect(storeInstance.updateProjectThread).toHaveBeenCalledWith("p1", "thread-new-rollout");
    expect(updateBinding).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-new-rollout" }), "thread-new-rollout");
    expect(storeInstance.updateRun).toHaveBeenLastCalledWith("run-rollout", { threadId: "thread-new-rollout", turnId: "turn-new-rollout", status: "running" });
  });

  it("turn/start 竞态失效时只新建并重试一次", async () => {
    const storeInstance = mockStore();
    const { bridge } = bridgeWith(storeInstance);
    let starts = 0;
    bridge.request = vi.fn(async (method) => {
      if (method === "thread/resume") return { thread: { id: "thread-old" } };
      if (method === "thread/start") return { thread: { id: "thread-new" } };
      if (method === "thread/name/set") return {};
      if (method === "turn/start") {
        starts += 1;
        if (starts === 1) throw new Error("turn/start: thread not found: thread-old");
        return { turn: { id: "turn-new" } };
      }
      throw new Error(`unexpected ${method}`);
    });

    const result = await bridge.startSkill({ runId: "run-3", project, skillName: "vibe-research-workflow", prompt: "test" });

    expect(starts).toBe(2);
    expect(result.threadId).toBe("thread-new");
  });

  it("排队期间取消后，迟到的 turn/start 不会把任务复活为运行中", async () => {
    let run = { id: "run-cancel-race", status: "queued", cancelRequestedAt: null };
    const storeInstance = {
      ...mockStore(),
      getRun: vi.fn(() => run),
      updateRun: vi.fn((id, patch) => { run = { ...run, ...patch }; return run; }),
    };
    const { bridge } = bridgeWith(storeInstance);
    bridge.loadedThreads.add("thread-old");
    bridge.request = vi.fn(async (method) => {
      if (method === "turn/start") {
        run = { ...run, status: "cancelled", cancelRequestedAt: "2026-09-18T00:00:00.000Z" };
        return { turn: { id: "turn-late" } };
      }
      if (method === "turn/interrupt") return {};
      throw new Error(`unexpected ${method}`);
    });

    const result = await bridge.startSkill({ runId: run.id, project, skillName: "vibe-research-workflow", prompt: "test" });

    expect(result).toEqual({ cancelled: true, threadId: "thread-old", turnId: "turn-late" });
    expect(bridge.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-old", turnId: "turn-late" });
    expect(storeInstance.updateRun).not.toHaveBeenCalledWith(run.id, expect.objectContaining({ status: "running" }));
    expect(bridge.activeByThread.has("thread-old")).toBe(false);
  });

  it("取消时立即终结共享同一 turn 的历史重复记录", async () => {
    const projectPath = path.join(isolatedData, "cancel-project");
    await mkdir(path.join(projectPath, "99-system"), { recursive: true });
    await writeFile(path.join(projectPath, "99-system", "runs.jsonl"), "", "utf8");
    const projectWithPath = { ...project, projectPath };
    const runs = new Map([
      ["run-a", { id: "run-a", projectId: "p1", skillName: "drawio-reconstruction", threadId: "thread-old", turnId: "turn-shared", status: "running", output: "partial", reviewStatus: "pending", startedAt: "2026-09-15T06:00:00.000Z" }],
      ["run-b", { id: "run-b", projectId: "p1", skillName: "drawio-reconstruction", threadId: "thread-old", turnId: "turn-shared", status: "running", output: "", reviewStatus: "pending", startedAt: "2026-09-15T06:00:01.000Z" }],
    ]);
    const storeInstance = {
      getRun: vi.fn((id) => runs.get(id) || null),
      getProject: vi.fn(() => projectWithPath),
      listRuns: vi.fn(() => [...runs.values()]),
      updateRun: vi.fn((id, patch) => { const updated = { ...runs.get(id), ...patch }; runs.set(id, updated); return updated; }),
      resolveApproval: vi.fn(),
    };
    const { bridge } = bridgeWith(storeInstance);
    bridge.request = vi.fn(async () => ({}));
    bridge.activeByThread.set("thread-old", "run-b");

    const result = await bridge.cancelRun("run-a");

    expect(bridge.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-old", turnId: "turn-shared" });
    expect(result.relatedRunIds).toEqual(expect.arrayContaining(["run-a", "run-b"]));
    expect(runs.get("run-a").status).toBe("cancelled");
    expect(runs.get("run-b").status).toBe("cancelled");
    expect(bridge.activeByThread.has("thread-old")).toBe(false);
  });
});

describe("重新运行提示", () => {
  it("连续重试时只保留一次提示", () => {
    const once = buildRetryPrompt("原始任务");
    const repeated = buildRetryPrompt(buildRetryPrompt(once));
    expect(repeated).toBe(`原始任务\n\n---\n${RETRY_NOTE}`);
    expect(repeated.match(new RegExp(RETRY_NOTE, "gu"))).toHaveLength(1);
  });
});
