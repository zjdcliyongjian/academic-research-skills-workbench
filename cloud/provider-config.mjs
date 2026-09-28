export const VOLCENGINE_AGENT_PLAN_PROVIDER = "volcengine_agent_plan";
export const VOLCENGINE_AGENT_PLAN_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3";

const AGENT_PLAN_MODEL_ALIASES = new Map([
  ["deepseek-flash", "deepseek-v4.1-flash"],
]);

function isAgentPlanAddress(baseUrl) {
  try {
    const url = new URL(String(baseUrl || "").trim());
    if (url.hostname.toLowerCase() !== "ark.cn-beijing.volces.com") return false;
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return path === "/api/plan" || path === "/api/plan/v3" || path === "/api/url";
  } catch {
    return false;
  }
}

/**
 * Keeps the Agent Plan protocol, endpoint and model ID together. The /api/url
 * branch repairs the typo shown by early workbench users; it is intentionally
 * limited to the official Agent Plan host so unrelated custom URLs are left
 * untouched.
 */
export function normalizeCloudProviderInput(input = {}) {
  const original = {
    provider: String(input.provider || "custom").trim().toLowerCase(),
    model: String(input.model || "").trim(),
    baseUrl: String(input.baseUrl ?? input.base_url ?? "").trim().replace(/\/+$/, ""),
  };
  const agentPlan = original.provider === VOLCENGINE_AGENT_PLAN_PROVIDER || isAgentPlanAddress(original.baseUrl);
  if (!agentPlan) return { ...original, corrected: false };

  const model = AGENT_PLAN_MODEL_ALIASES.get(original.model.toLowerCase()) || original.model || "ark-code-latest";
  return {
    provider: VOLCENGINE_AGENT_PLAN_PROVIDER,
    model,
    baseUrl: VOLCENGINE_AGENT_PLAN_BASE_URL,
    corrected: original.provider !== VOLCENGINE_AGENT_PLAN_PROVIDER
      || original.baseUrl !== VOLCENGINE_AGENT_PLAN_BASE_URL
      || model !== original.model,
  };
}
