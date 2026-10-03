import { describe, expect, it, vi } from "vitest";
import { CodexBridge, isSafeReadOnlyApprovalRequest } from "../server/codex-bridge.mjs";

const project = {
  id: "project-1",
  projectPath: "C:\\Users\\Lenovo\\ARSCodexResearchVault\\project-1",
};

function request(command, overrides = {}) {
  return {
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      cwd: project.projectPath,
      commandActions: [{ command }],
      ...overrides,
    },
  };
}

describe("safe local read-only approvals", () => {
  it("auto-allows reads limited to the project, Skill and memory roots", () => {
    const command = [
      "$files = @(",
      "'C:\\Users\\Lenovo\\.codex\\skills\\academic-research-suite\\SKILL.md',",
      "'C:\\Users\\Lenovo\\.codex\\memories\\MEMORY.md'",
      "); foreach ($file in $files) { Write-Output $file; Get-Content -LiteralPath $file }",
    ].join(" ");
    expect(isSafeReadOnlyApprovalRequest(request(command), project, { homeDirectory: "C:\\Users\\Lenovo" })).toBe(true);
  });

  it("allows project-local path joins, read-only selection and ripgrep searches", () => {
    const command = "$root='C:\\Users\\Lenovo\\ARSCodexResearchVault\\project-1'; $files=@((Join-Path $root '00-index.md')); foreach($f in $files){ Get-Content -LiteralPath $f -Raw }; rg -n --no-heading \"范围界定\" 'C:\\Users\\Lenovo\\.codex\\memories\\MEMORY.md'";
    expect(isSafeReadOnlyApprovalRequest(request(command), project, { homeDirectory: "C:\\Users\\Lenovo" })).toBe(true);
  });

  it.each([
    "Set-Content -LiteralPath 'C:\\Users\\Lenovo\\ARSCodexResearchVault\\project-1\\draft.md' -Value 'changed'",
    "Remove-Item -LiteralPath 'C:\\Users\\Lenovo\\ARSCodexResearchVault\\project-1\\draft.md'",
    "Invoke-WebRequest https://example.com",
    "Get-Content -LiteralPath 'C:\\Users\\Lenovo\\Documents\\private.txt'",
    "Get-Content ..\\outside.txt",
  ])("keeps unsafe or out-of-scope operations behind approval: %s", (command) => {
    expect(isSafeReadOnlyApprovalRequest(request(command), project, { homeDirectory: "C:\\Users\\Lenovo" })).toBe(false);
  });

  it("accepts a safe read request without creating a user approval card", async () => {
    const run = { id: "run-1", projectId: project.id, status: "running" };
    const store = {
      getRun: vi.fn(() => run),
      getProject: vi.fn(() => project),
      updateRun: vi.fn((id, patch) => ({ ...run, ...patch })),
      createApproval: vi.fn(),
    };
    const bridge = new CodexBridge({ storeInstance: store });
    bridge.activeByThread.set("thread-1", run.id);
    bridge.send = vi.fn();

    await bridge.handleServerRequest(request("Get-Content -LiteralPath 'C:\\Users\\Lenovo\\.codex\\memories\\MEMORY.md'"));

    expect(bridge.send).toHaveBeenCalledWith({ id: 42, result: { decision: "accept" } });
    expect(store.createApproval).not.toHaveBeenCalled();
    expect(store.updateRun).toHaveBeenCalledWith(run.id, { status: "running" });
  });
});
