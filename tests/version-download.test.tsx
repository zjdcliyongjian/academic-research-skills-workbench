import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunConsole, StageHistory } from "../src/App";
import { downloadMarkdown, markdownFileName } from "../src/versionDownload";
import type { RunRecord, StageVersion } from "../src/types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("version export", () => {
  it("keeps draft preview, exports both, and places formal export on the right", () => {
    const run = { id: "r1", skillName: "idea-evaluator", status: "completed", reviewStatus: "pending", output: "# 草稿", startedAt: new Date().toISOString() } as RunRecord;
    const version = { id: "v1", stage: "idea", projectId: "p1", skillName: "idea-evaluator", versionNumber: 1, status: "active", adoptedAt: new Date().toISOString() } as StageVersion;
    const html = renderToStaticMarkup(<StageHistory stage="idea" runs={[run]} versions={[version]} activeRunId="r1" onSelect={() => {}} onAdopt={() => {}} onDelete={() => {}}/>);
    expect(html.match(/>预览<\/button>/g)).toHaveLength(1);
    expect(html.match(/>导出<\/button>/g)).toHaveLength(2);
    expect(html).toContain("采用此版本");
    expect(html).not.toContain("驳回");
    expect(html).toMatch(/class="version-actions"[\s\S]*title="导出此正式版本为 Markdown 文件"/);
  });
  it("keeps adopt and reject actions out of the live conversation card", () => {
    const run = { id: "r1", skillName: "idea-evaluator", status: "completed", reviewStatus: "pending", output: "# 草稿", prompt: "评估构想", startedAt: new Date().toISOString() } as RunRecord;
    const html = renderToStaticMarkup(<RunConsole run={run} approvals={[]} busy="" onRetry={() => {}} onCancel={() => {}} onResolve={() => {}}/>);
    expect(html).not.toContain("采用此版本");
    expect(html).not.toContain("驳回");
  });
  it("downloads exact UTF-8 content with a safe filename and cleans up", async () => {
    const click = vi.fn(), remove = vi.fn(), appendChild = vi.fn(), later = vi.fn();
    const link = { href: "", download: "", click, remove };
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild } });
    vi.stubGlobal("window", { setTimeout: later });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const filename = markdownFileName("研究/路线", "正式版本-V001", "id1");
    downloadMarkdown("# 中文正文", filename);
    expect(filename).toBe("研究-路线-正式版本-V001-id1.md");
    expect(link.download).toBe(filename);
    expect(await (create.mock.calls[0][0] as Blob).text()).toBe("# 中文正文");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    later.mock.calls[0][0]();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
  it("rejects empty content", () => {
    expect(() => downloadMarkdown("  ", "empty.md")).toThrow("暂无");
  });
});
