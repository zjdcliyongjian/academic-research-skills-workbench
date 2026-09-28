import { describe, expect, it } from "vitest";
import { buildProjectReadiness } from "../server/trial-readiness.mjs";

const project = { stage: "writing" };

describe("科研人员试用就绪检查", () => {
  it("移除证据卡后核验来源即可继续，不推荐已移除入口", () => {
    const result = buildProjectReadiness(project, [{ status: "content-verified" }], [], [], [{ id: "v1", stage: "blueprint", status: "active" }]);
    expect(result.status).toBe("ready");
    expect(JSON.stringify(result.nextActions)).not.toContain("证据卡");
  });
  it("缺少上游正式蓝图时阻止章节写作", () => {
    const result = buildProjectReadiness(project, [], [], [], []);
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("缺少已采用的论文蓝图版本");
    expect(result.nextActions[0].view).toBe("sources");
  });

  it("具备上游版本与核验证据后允许继续", () => {
    const sources = [{ status: "content-verified", processingStatus: "content_verified" }];
    const claims = [{ claimType: "source_fact", verificationStatus: "verified" }];
    const versions = [{ id: "v1", stage: "blueprint", status: "active" }];
    const result = buildProjectReadiness(project, sources, claims, [], versions);
    expect(result.status).toBe("ready");
    expect(result.blockers).toEqual([]);
    expect(result.counts.verifiedFacts).toBe(1);
  });

  it("把失败运行与冲突证据明确列为警告", () => {
    const sources = [{ status: "content-verified", processingStatus: "content_verified" }];
    const claims = [{ claimType: "source_fact", verificationStatus: "conflicted" }];
    const versions = [{ id: "v1", stage: "blueprint", status: "active" }];
    const runs = [{ status: "failed" }];
    const result = buildProjectReadiness(project, sources, claims, runs, versions);
    expect(result.status).toBe("warning");
    expect(result.warnings.join(" ")).toContain("证据仍待核验或存在冲突");
    expect(result.warnings.join(" ")).toContain("运行失败");
  });
});
