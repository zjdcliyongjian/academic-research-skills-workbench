const claimTypes = new Set(["source_fact", "synthesis", "inference", "unknown"]);
const reviewStatuses = new Set(["pending", "verified", "rejected", "conflicted"]);
const reviewDecisions = new Set(["adopt", "reject", "request_revision"]);

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function validateEvidenceInput(input, source, projectId) {
  const claimType = String(input.claimType || "").trim();
  if (!claimTypes.has(claimType)) throw badRequest("无效的证据类型");
  if (input.sourceId && !source) throw badRequest("关联来源不存在");
  if (source && source.project_id !== projectId) throw Object.assign(new Error("关联来源不属于当前课题"), { statusCode: 403 });
  if (claimType === "source_fact" && !source) throw badRequest("来源事实必须关联来源");
  if (claimType === "source_fact" && source.status !== "content-verified") throw badRequest("来源事实只能关联已人工确认内容的来源");
  if (claimType === "source_fact" && !String(input.locator || "").trim()) throw badRequest("来源事实必须填写页码、章节或段落定位");
  return claimType;
}

export function validateEvidenceReview(status, claim, source) {
  if (!reviewStatuses.has(status)) throw badRequest("无效的证据核验状态");
  if (status === "verified" && claim.claim_type === "source_fact") {
    if (!source || source.status !== "content-verified") throw badRequest("来源事实只能在关联来源正文已人工确认后核验");
    if (!String(claim.locator || "").trim()) throw badRequest("来源事实缺少页码、章节或段落定位，不能核验");
  }
}

export function validateReviewDecision(decision, note) {
  if (!reviewDecisions.has(decision)) throw badRequest("无效的内容审阅决定");
  if (["reject", "request_revision"].includes(decision) && !String(note || "").trim()) {
    throw badRequest(decision === "reject" ? "驳回时必须填写原因" : "要求修改时必须填写具体要求");
  }
}
