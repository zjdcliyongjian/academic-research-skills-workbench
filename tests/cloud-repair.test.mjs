import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { buildVerifiedBibtex } from "../cloud/bibtex.mjs";
import { encryptSecret } from "../cloud/crypto.mjs";
import { validateEvidenceInput, validateEvidenceReview, validateReviewDecision } from "../cloud/validation.mjs";
import { normalizeCloudProviderInput, VOLCENGINE_AGENT_PLAN_BASE_URL } from "../cloud/provider-config.mjs";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

describe("cloud evidence validation parity", () => {
  const verifiedSource = { id: "source-1", project_id: "project-1", status: "content-verified" };

  it("requires a content-verified source and locator for source facts", () => {
    expect(() => validateEvidenceInput({ claimType: "source_fact", sourceId: "source-1", locator: "" }, verifiedSource, "project-1")).toThrow(/定位/);
    expect(() => validateEvidenceInput({ claimType: "source_fact", locator: "p.1" }, null, "project-1")).toThrow(/关联来源/);
    expect(() => validateEvidenceInput({ claimType: "source_fact", sourceId: "source-1", locator: "p.1" }, { ...verifiedSource, status: "metadata-verified" }, "project-1")).toThrow(/人工确认内容/);
    expect(validateEvidenceInput({ claimType: "source_fact", sourceId: "source-1", locator: "p.1" }, verifiedSource, "project-1")).toBe("source_fact");
  });

  it("rejects cross-project sources and invalid review states", () => {
    expect(() => validateEvidenceInput({ claimType: "synthesis", sourceId: "source-1" }, verifiedSource, "project-2")).toThrow(/不属于当前课题/);
    expect(() => validateEvidenceReview("made_up", { claim_type: "synthesis" }, null)).toThrow(/核验状态/);
  });

  it("requires reasons for reject and revision decisions", () => {
    expect(() => validateReviewDecision("reject", "")).toThrow(/驳回时必须/);
    expect(() => validateReviewDecision("request_revision", "   ")).toThrow(/具体要求/);
    expect(() => validateReviewDecision("adopt", "")).not.toThrow();
  });
});

describe("cloud formal BibTeX", () => {
  it("exports only human-verified sources with normalized fields", () => {
    const output = buildVerifiedBibtex([
      { id: "verified", status: "content-verified", title: "A {Safe} Paper", authors: ["Jane Doe", "Li Ming"], publication_year: 2025, venue: "Test Journal", doi: "https://doi.org/10.1/demo", url: "https://example.com/paper" },
      { id: "raw", status: "raw", title: "Must Not Export", authors: ["Unknown"] },
    ]);
    expect(output).toContain("@article{Doe202501");
    expect(output).toContain("author = {Jane Doe and Li Ming}");
    expect(output).toContain("doi = {10.1/demo}");
    expect(output).not.toContain("Must Not Export");
  });

  it("fails instead of fabricating an empty citation library", () => {
    expect(() => buildVerifiedBibtex([{ id: "raw", status: "raw", title: "Unverified" }])).toThrow(/没有已核验/);
  });
});

describe("cloud model connection check", () => {
  const originalMasterKey = process.env.BYOK_MASTER_KEY;
  beforeEach(() => {
    process.env.BYOK_MASTER_KEY = randomBytes(32).toString("base64");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalMasterKey === undefined) delete process.env.BYOK_MASTER_KEY; else process.env.BYOK_MASTER_KEY = originalMasterKey;
  });

  it("uses the configured compatible endpoint and a bounded test request", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    const result = await callModel(
      { base_url: "https://api.example.com/v1", model: "demo-model", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "connection-test",
      { timeoutMs: 1000, maxTokens: 32, thinking: "disabled" },
    );
    expect(result).toBe("OK");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse(init.body).max_tokens).toBe(32);
    expect(JSON.parse(init.body).thinking).toEqual({ type: "disabled" });
  });

  it("binds the Volcengine Agent Plan model to its OpenAI-compatible endpoint", async () => {
    const normalized = normalizeCloudProviderInput({
      provider: "volcengine_agent_plan",
      model: "deepseek-v4.1-flash",
      baseUrl: "https://ark.cn-beijing.volces.com/api/url",
    });
    expect(normalized).toMatchObject({
      provider: "volcengine_agent_plan",
      model: "deepseek-v4.1-flash",
      baseUrl: VOLCENGINE_AGENT_PLAN_BASE_URL,
      corrected: true,
    });

    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: normalized.provider, base_url: normalized.baseUrl, model: normalized.model, encrypted_api_key: encryptSecret("ark-plan-secret-123456") },
      [{ role: "user", content: "test" }],
      "agent-plan-connection-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "deepseek-v4.1-flash", max_tokens: 32 });
    expect(JSON.parse(init.body)).not.toHaveProperty("temperature");
  });

  it("repairs the legacy DeepSeek selection when an Agent Plan URL was entered", () => {
    expect(normalizeCloudProviderInput({
      provider: "deepseek",
      model: "deepseek-flash",
      baseUrl: "https://ark.cn-beijing.volces.com/api/url",
    })).toMatchObject({
      provider: "volcengine_agent_plan",
      model: "deepseek-v4.1-flash",
      baseUrl: VOLCENGINE_AGENT_PLAN_BASE_URL,
      corrected: true,
    });
  });

  it("allows provider-specific temperature requirements", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: "kimi", base_url: "https://api.example.com/v1", model: "kimi-k2.6", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "kimi-connection-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body).temperature).toBe(1);
  });

  it("keeps Kimi Code on its fixed model without open-platform-only parameters", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: "kimi_code", base_url: "https://api.kimi.com/coding/v1", model: "kimi-for-coding", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "kimi-code-connection-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    const [, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe("kimi-for-coding");
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("thinking");
  });

  it("uses the required GLM 5.3 parameters", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: "zhipu", base_url: "https://api.example.com/v1", model: "glm-5.3", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "zhipu-connection-test",
      { timeoutMs: 1000, maxTokens: 32, thinking: "enabled", reasoningEffort: "low" },
    );
    const [, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.temperature).toBe(1);
    expect(payload.thinking).toEqual({ type: "enabled" });
    expect(payload.reasoning_effort).toBe("low");
  });

  it("reads and normalizes the models available to the current API key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "latest-model" }, { model: "fast-model" }, { id: "latest-model" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { listAvailableModels } = await import("../cloud/model-gateway.mjs");
    const result = await listAvailableModels("https://api.example.com/v1", "sk-demo-secret-123456", 1000);
    expect(result).toEqual(["latest-model", "fast-model"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(init.headers.Authorization).toBe("Bearer sk-demo-secret-123456");
  });

  it("uses max_completion_tokens and omits temperature for OpenAI reasoning models", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: "openai", base_url: "https://api.example.com/v1", model: "gpt-5", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "openai-reasoning-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    const [, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.max_completion_tokens).toBe(32);
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("temperature");
  });

  it("supports Gemini through Google's OpenAI-compatible endpoint", async () => {
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await callModel(
      { provider: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash", encrypted_api_key: encryptSecret("google-api-key-123456") },
      [{ role: "user", content: "test" }],
      "gemini-connection-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    const [url, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(init.headers["x-goog-api-client"]).toBe("ai-research-copilot/0.4.1");
    expect(payload.model).toBe("gemini-3.5-flash");
    expect(payload).not.toHaveProperty("temperature");
  });

  it("retries once after a compatible endpoint rejects temperature", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temperature is unsupported" } }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    const result = await callModel(
      { provider: "qwen", base_url: "https://api.example.com/v1", model: "demo-model", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "compatibility-retry-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    expect(result).toBe("OK");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).temperature).toBe(0.2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty("temperature");
  });

  it("reads array-based text content returned by compatible providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "OK" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    const result = await callModel(
      { provider: "custom", base_url: "https://api.example.com/v1", model: "demo-model", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "array-content-test",
      { timeoutMs: 1000, maxTokens: 32 },
    );
    expect(result).toBe("OK");
  });

  it("reports a model timeout separately from a user cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    const pending = callModel(
      { provider: "zhipu", base_url: "https://api.example.com/v1", model: "glm-5.3", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "timeout-message-test",
      { timeoutMs: 10, maxTokens: 32 },
    );
    const assertion = expect(pending).rejects.toThrow(/模型调用超过 1 秒/);
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });

  it("turns a low-level fetch failure into an actionable network message", async () => {
    const cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause }); }));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await expect(callModel(
      { provider: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", encrypted_api_key: encryptSecret("google-api-key-123456") },
      [{ role: "user", content: "test" }],
      "network-failure-test",
      { timeoutMs: 1000, maxTokens: 32 },
    )).rejects.toThrow(/无法连接模型接口 generativelanguage\.googleapis\.com.*检查网络或代理/);
  });

  it("does not retry authentication failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid token" } }), { status: 401, headers: { "Content-Type": "application/json" } })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await expect(callModel(
      { provider: "custom", base_url: "https://api.example.com/v1", model: "demo-model", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "auth-failure-test",
      { timeoutMs: 1000, maxTokens: 32 },
    )).rejects.toThrow(/API Key 无效/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("turns provider capacity errors into an actionable switch-model message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Selected model is at capacity. Please try a different model." } }), { status: 503, headers: { "Content-Type": "application/json" } })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await expect(callModel(
      { provider: "openai", base_url: "https://api.example.com/v1", model: "gpt-capacity-test", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "capacity-message-test",
      { timeoutMs: 1000, maxTokens: 32 },
    )).rejects.toThrow(/当前模型暂时无可用容量.*模型配置.*切换/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("explains Kimi product and endpoint mismatches on authentication failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid Authentication" } }), { status: 401, headers: { "Content-Type": "application/json" } })));
    const { callModel } = await import("../cloud/model-gateway.mjs");
    await expect(callModel(
      { provider: "kimi", base_url: "https://api.moonshot.cn/v1", model: "kimi-k3", encrypted_api_key: encryptSecret("sk-demo-secret-123456") },
      [{ role: "user", content: "test" }],
      "kimi-auth-failure-test",
      { timeoutMs: 1000, maxTokens: 32 },
    )).rejects.toThrow(/Kimi Code.*会员控制台/);
  });
});
