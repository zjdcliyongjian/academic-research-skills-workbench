import { PROJECT_STAGES } from "./research-state.mjs";

const STAGE_LABELS = {
  brief: "范围界定",
  idea: "深度调研",
  research: "论文写作",
  blueprint: "完整性核验Ⅰ",
  writing: "同行评审",
  production: "返修与复审",
  review: "最终核验与定稿",
  export: "正式交付",
};

const UPSTREAM = {
  research: "idea",
  blueprint: "research",
  writing: "blueprint",
  production: "writing",
  review: "production",
};

export function buildProjectReadiness(project, sources = [], evidenceClaims = [], runs = [], versions = []) {
  const activeVersions = new Map(versions.filter((item) => item.status === "active").map((item) => [item.stage, item]));
  const verifiedSources = sources.filter((item) => item.status === "content-verified");
  const verifiedFacts = evidenceClaims.filter((item) => item.claimType === "source_fact" && item.verificationStatus === "verified");
  const unresolvedEvidence = evidenceClaims.filter((item) => ["pending", "conflicted"].includes(item.verificationStatus));
  const activeRuns = runs.filter((item) => ["queued", "running", "waiting_approval"].includes(item.status));
  const failedRuns = runs.filter((item) => item.status === "failed");
  const needsReview = versions.filter((item) => item.status === "needs_review");

  const stages = PROJECT_STAGES.map((stage) => {
    const blockers = [];
    const warnings = [];
    const upstream = UPSTREAM[stage];
    if (upstream && !activeVersions.has(upstream)) blockers.push(`缺少已采用的${STAGE_LABELS[upstream]}版本`);
    if (["research", "blueprint", "writing", "production", "review", "export"].includes(stage) && verifiedSources.length === 0) {
      warnings.push("尚无内容已核验的来源");
    }
    if (stage === "export" && ![...activeVersions.keys()].length) blockers.push("尚无任何人工采用的正式版本");
    if (needsReview.some((item) => item.stage === stage)) warnings.push("该阶段存在受上游变更影响、需要复核的版本");
    return {
      stage,
      label: STAGE_LABELS[stage],
      status: blockers.length ? "blocked" : warnings.length ? "warning" : "ready",
      blockers,
      warnings,
      activeVersionId: activeVersions.get(stage)?.id || null,
    };
  });

  const currentStage = stages.find((item) => item.stage === project.stage) || stages[0];
  const blockers = [...currentStage.blockers];
  const warnings = [...currentStage.warnings];
  if (!sources.length) warnings.push("资料台账为空，后续结论只能作为待核验草稿");
  if (sources.some((item) => item.processingStatus === "failed")) warnings.push("存在处理失败的来源，请查看失败原因并重试");
  if (unresolvedEvidence.length) warnings.push(`${unresolvedEvidence.length} 条证据仍待核验或存在冲突`);
  if (failedRuns.length) warnings.push(`${failedRuns.length} 次运行失败，建议清理或重试`);
  if (activeRuns.length) warnings.push(`${activeRuns.length} 个任务正在运行或等待审批`);

  const nextActions = [];
  if (!sources.length) nextActions.push({ view: "sources", label: "添加并处理可信资料" });
  else if (!verifiedSources.length) nextActions.push({ view: "sources", label: "核验至少一个来源的元数据与正文" });
  if (currentStage.blockers.length) nextActions.push({ view: upstreamView(project.stage), label: `先完成${currentStage.blockers[0].replace(/^缺少已采用的/, "").replace(/版本$/, "")}` });
  if (!nextActions.length) nextActions.push({ view: stageView(project.stage), label: `继续${currentStage.label}` });

  return {
    status: blockers.length ? "blocked" : warnings.length ? "warning" : "ready",
    stage: project.stage,
    blockers,
    warnings: [...new Set(warnings)],
    nextActions,
    counts: {
      sources: sources.length,
      verifiedSources: verifiedSources.length,
      evidenceClaims: evidenceClaims.length,
      verifiedFacts: verifiedFacts.length,
      unresolvedEvidence: unresolvedEvidence.length,
      activeRuns: activeRuns.length,
      failedRuns: failedRuns.length,
      activeVersions: activeVersions.size,
      needsReviewVersions: needsReview.length,
    },
    stages,
  };
}

function stageView(stage) {
  return stage === "brief" ? "workflow" : stage === "export" ? "export" : stage;
}

function upstreamView(stage) {
  return stageView(UPSTREAM[stage] || "sources");
}
