import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceWorkspace } from "../src/SourceWorkspace";
import type { ResearchProject, SourceUploadItem } from "../src/types";

const project = { id: "project-1", name: "测试课题" } as ResearchProject;

function failedUpload(): SourceUploadItem {
  const file = new File(["paper"], "paper.pdf", { type: "application/pdf" });
  return { id: "upload-1", file, name: file.name, size: file.size, status: "failed", error: "操作过于频繁，请稍后再试" };
}

describe("source workspace upload failures", () => {
  it("shows a per-file retry action for a failed upload", () => {
    const html = renderToStaticMarkup(<SourceWorkspace
      project={project}
      detail={null}
      busy=""
      uploadItems={[failedUpload()]}
      url=""
      setUrl={() => undefined}
      onUpload={() => undefined}
      onRetryUpload={() => undefined}
      onAddUrl={() => undefined}
      onReload={async () => undefined}
      onNotice={() => undefined}
    />);

    expect(html).toContain("上传失败");
    expect(html).toContain("重新上传");
    expect(html).toContain("操作过于频繁，请稍后再试");
  });
});
