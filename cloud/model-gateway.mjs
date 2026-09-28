import { decryptSecret } from "./crypto.mjs";
import { assertPublicHttpsUrl } from "./security.mjs";
import { normalizeCloudProviderInput } from "./provider-config.mjs";

const activeControllers = new Map();

const REASONING_MODEL_PATTERN = /^(?:o\d|gpt-(?:5|6))(?:[-_.]|$)/i;

function normalizedProvider(config) {
  return String(config?.provider || "custom").trim().toLowerCase();
}

function errorMessage(data, status) {
  return data?.error?.message || data?.message || `模型接口返回 HTTP ${status}`;
}

function capacityMessage(message) {
  return /selected model is at capacity|model\s+(?:is\s+)?(?:currently\s+)?(?:at capacity|overloaded)|(?:at capacity|overloaded).*model|temporarily unavailable.*model/i.test(String(message || ""));
}

function authenticationHint(baseUrl) {
  const value = String(baseUrl || "").toLowerCase();
  if (value.includes("ark.cn-beijing.volces.com/api/plan")) return "当前地址只接受火山方舟 Agent Plan 专属 API Key；普通火山方舟 API Key 不能混用。";
  if (value.includes("api.moonshot.cn")) return "当前地址只接受 Kimi 中国站开放平台 Key；如果 Key 来自 Kimi Code/会员控制台，请在模型平台选择“Kimi Code（会员额度）”。";
  if (value.includes("api.moonshot.ai")) return "当前地址只接受 Kimi 国际站开放平台 Key；中国站和国际站 Key 不能混用。";
  if (value.includes("api.kimi.com/coding")) return "当前地址只接受 Kimi Code 控制台生成的 Key；开放平台 Key 请改选 Kimi 中国站或国际站。";
  return "";
}

function networkFailure(error, baseUrl) {
  if (!(error instanceof Error) || !/fetch failed|network|connect|socket|dns/i.test(`${error.message} ${error.cause?.message || ""}`)) return null;
  const host = (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })();
  const code = error.cause?.code ? `（${error.cause.code}）` : "";
  return new Error(`无法连接模型接口 ${host}${code}。请检查网络或代理是否已开启，然后重试`);
}

function textFromPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  return "";
}

export function extractModelText(data) {
  if (Array.isArray(data?.content)) return data.content.filter(part => part.type === "text").map(part => part.text || "").join("\n").trim();
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string" && message.content.trim()) return message.content.trim();
  if (Array.isArray(message?.content)) {
    const combined = message.content.map(textFromPart).filter(Boolean).join("\n").trim();
    if (combined) return combined;
  }
  if (typeof data?.choices?.[0]?.text === "string" && data.choices[0].text.trim()) return data.choices[0].text.trim();
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data?.output)) {
    const combined = data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [item]).map(textFromPart).filter(Boolean).join("\n").trim();
    if (combined) return combined;
  }
  return "";
}

export function buildChatPayload(config, messages, options = {}) {
  const provider = normalizedProvider(config);
  const model = String(config?.model || "").trim();
  if (provider === "anthropic") {
    const system = messages.filter(item => item.role === "system").map(item => item.content).join("\n\n");
    return { model, stream: false, max_tokens: Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 8192,
      thinking: { type: "disabled" },
      ...(system ? { system } : {}),
      messages: messages.filter(item => item.role !== "system").map(item => ({ role: item.role, content: item.content })) };
  }
  const payload = { model, messages, stream: false };

  const configuredTemperature = Number.isFinite(options.temperature) ? Number(options.temperature) : null;
  if (configuredTemperature !== null) payload.temperature = configuredTemperature;
  else if (["kimi", "kimi_global"].includes(provider) || (provider === "zhipu" && /^glm-5\.3(?:[-_.]|$)/i.test(model))) payload.temperature = 1;
  else if (!["custom", "kimi_code", "gemini", "volcengine_agent_plan"].includes(provider) && !(provider === "openai" && REASONING_MODEL_PATTERN.test(model))) payload.temperature = 0.2;

  if (Number(options.maxTokens) > 0) {
    const tokenField = provider === "openai" && REASONING_MODEL_PATTERN.test(model) ? "max_completion_tokens" : "max_tokens";
    payload[tokenField] = Number(options.maxTokens);
  }
  if (options.thinking) payload.thinking = { type: options.thinking };
  if (options.reasoningEffort) payload.reasoning_effort = options.reasoningEffort;
  return payload;
}

export async function listAvailableModels(baseUrl, apiKey, timeoutMs = 15_000, provider = "") {
  await assertPublicHttpsUrl(baseUrl, "模型接口地址");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("读取模型列表超时")), timeoutMs);
  try {
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    if (provider === "anthropic") { delete headers.Authorization; headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; }
    if (/generativelanguage\.googleapis\.com/i.test(baseUrl)) headers["x-goog-api-client"] = "ai-research-copilot/0.4.1";
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = errorMessage(data, response.status);
      if (response.status === 401) throw new Error(`API Key 无效或已失效：${message}${authenticationHint(baseUrl) ? `。${authenticationHint(baseUrl)}` : ""}`);
      if (response.status === 403) throw new Error(`API Key 没有读取模型列表的权限：${message}`);
      throw new Error(message);
    }
    const candidates = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    const models = candidates.map((item) => typeof item === "string" ? item : item?.id || item?.model || item?.name).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
    return [...new Set(models)].slice(0, 200);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("读取模型列表超时，请检查接口地址或稍后重试");
    const networkError = networkFailure(error, baseUrl);
    if (networkError) throw networkError;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function compatibleRetryPayload(payload, message) {
  const next = { ...payload };
  if (/temperature/i.test(message) && /only\s+1|must\s+be\s+1/i.test(message) && next.temperature !== 1) {
    next.temperature = 1;
    return next;
  }
  if (/temperature/i.test(message) && /unsupported|not\s+support|does\s+not\s+support|unknown|unrecognized|invalid/i.test(message) && "temperature" in next) {
    delete next.temperature;
    return next;
  }
  if (/max_tokens/i.test(message) && /max_completion_tokens|unsupported|not\s+support|unknown|unrecognized|invalid/i.test(message) && "max_tokens" in next) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
    return next;
  }
  if (/max_completion_tokens/i.test(message) && /max_tokens|unsupported|not\s+support|unknown|unrecognized|invalid/i.test(message) && "max_completion_tokens" in next) {
    next.max_tokens = next.max_completion_tokens;
    delete next.max_completion_tokens;
    return next;
  }
  if (/thinking/i.test(message) && /unsupported|not\s+support|unknown|unrecognized|invalid/i.test(message) && "thinking" in next) {
    delete next.thinking;
    return next;
  }
  return null;
}

export function abortActiveRun(runId) {
  const controller = activeControllers.get(runId);
  if (controller) controller.abort(new Error("用户取消运行"));
  return Boolean(controller);
}

export async function callModel(config, messages, runId, options = {}) {
  const normalized = normalizeCloudProviderInput(config);
  const resolvedConfig = { ...config, provider: normalized.provider, model: normalized.model, base_url: normalized.baseUrl };
  await assertPublicHttpsUrl(resolvedConfig.base_url, "模型接口地址");
  const provider = normalizedProvider(resolvedConfig);
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 240_000;
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(new Error(`模型调用超过 ${Math.ceil(timeoutMs / 1000)} 秒`));
  }, timeoutMs);
  activeControllers.set(runId, controller);
  try {
    const endpoint = `${resolvedConfig.base_url.replace(/\/+$/, "")}/${provider === "anthropic" ? "messages" : "chat/completions"}`;
    const headers = { Authorization: `Bearer ${decryptSecret(resolvedConfig.encrypted_api_key)}`, "Content-Type": "application/json" };
    if (provider === "anthropic") { headers["x-api-key"] = decryptSecret(resolvedConfig.encrypted_api_key); headers["anthropic-version"] = "2023-06-01"; delete headers.Authorization; }
    if (provider === "gemini") headers["x-goog-api-client"] = "ai-research-copilot/0.4.1";
    let payload = buildChatPayload(resolvedConfig, messages, options);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        if (options.rejectTruncation && (data?.choices?.[0]?.finish_reason === "length" || data?.stop_reason === "max_tokens")) throw new Error("模型输出被长度限制截断，未生成完整英文导出，请重试");
        const output = extractModelText(data);
        if (!output) throw new Error("模型接口调用成功，但未返回可读正文；请确认模型支持所选接口的文本输出");
        return output;
      }
      const message = errorMessage(data, response.status);
      const retryPayload = response.status === 400 && provider !== "anthropic" ? compatibleRetryPayload(payload, message) : null;
      if (retryPayload && attempt === 0) {
        payload = retryPayload;
        continue;
      }
      if (response.status === 401) throw new Error(`API Key 无效或已失效：${message}${authenticationHint(resolvedConfig.base_url) ? `。${authenticationHint(resolvedConfig.base_url)}` : ""}`);
      if (response.status === 403) throw new Error(`API Key 没有调用该模型的权限：${message}`);
      if (capacityMessage(message) || (response.status === 503 && /capacity|overload|unavailable/i.test(message))) {
        throw new Error(`当前模型暂时无可用容量，请到“模型配置”切换到其他已测试模型后重试：${message}`);
      }
      if (response.status === 429) throw new Error(`模型账户余额不足、额度用尽或请求过于频繁：${message}`);
      throw new Error(message);
    }
    throw new Error("模型兼容性重试失败");
  } catch (error) {
    if (timeoutTriggered) throw new Error(`模型调用超过 ${Math.ceil(timeoutMs / 1000)} 秒，请稍后重试或选择响应更快的模型`);
    if (controller.signal.aborted) throw new Error("运行已由用户取消");
    const networkError = networkFailure(error, resolvedConfig.base_url);
    if (networkError) throw networkError;
    throw error;
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(runId);
  }
}
