import { createHash } from "node:crypto";
import { Client, Receiver } from "@upstash/qstash";
import { waitUntil } from "@vercel/functions";
import { Redis } from "@upstash/redis";
import { adminClient, oneRow, projectBundle, updateRow } from "./repository.mjs";
import { buildCloudPrompt } from "./skills.mjs";
import { callModel } from "./model-gateway.mjs";
import { processSourceJob } from "./source-job.mjs";

let redisClient;
const memoryRateLimits = new Map();
function redis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  redisClient ||= new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redisClient;
}

const globalRunKey = "research:global:active-runs";

export async function reserveGlobalRunSlot(runId, limit = Number(process.env.MAX_GLOBAL_ACTIVE_RUNS || 20)) {
  const store = redis();
  if (!store || !Number.isFinite(limit) || limit < 1) return false;
  await store.sadd(globalRunKey, runId);
  const count = await store.scard(globalRunKey);
  if (count > limit) {
    await store.srem(globalRunKey, runId);
    throw Object.assign(new Error("当前试用任务较多，请稍后再试"), { statusCode: 429 });
  }
  await store.expire(globalRunKey, 60 * 60);
  return true;
}

export async function releaseGlobalRunSlot(runId) {
  const store = redis();
  if (store) await store.srem(globalRunKey, runId);
}

export async function enforceRateLimit(ownerId, limit = 12) {
  const store = redis();
  const minute = Math.floor(Date.now() / 60_000);
  const key = `research:rate:${ownerId}:${minute}`;
  if (!store) {
    const count = (memoryRateLimits.get(key) || 0) + 1;
    memoryRateLimits.set(key, count);
    if (memoryRateLimits.size > 1000) {
      for (const candidate of memoryRateLimits.keys()) if (!candidate.endsWith(`:${minute}`)) memoryRateLimits.delete(candidate);
    }
    if (count > limit) throw Object.assign(new Error("操作过于频繁，请稍后再试"), { statusCode: 429 });
    return;
  }
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, 90);
  if (count > limit) throw Object.assign(new Error("操作过于频繁，请稍后再试"), { statusCode: 429 });
}

export async function executeRun(ownerId, runId) {
  let run;
  try {
    run = await oneRow("runs", ownerId, runId);
    if (["cancelled", "completed"].includes(run.status) || run.cancel_requested_at) return;
    await updateRow("runs", ownerId, runId, { status: "running", error: null });
    const bundle = await projectBundle(ownerId, run.project_id, { includeContent: true });
    const modelResult = await adminClient().from("model_configs").select("*").eq("owner_id", ownerId).eq("is_default", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (modelResult.error) throw new Error(modelResult.error.message);
    if (!modelResult.data) throw new Error("尚未配置默认模型，请先在右上角填写模型 API");
    const prompt = buildCloudPrompt({
      project: bundle.project,
      skillName: run.skill_name,
      input: JSON.parse(run.input_json || "{}"),
      sources: bundle.sources,
      evidenceClaims: bundle.evidenceClaims,
      versions: bundle.versions,
    });
    const output = await callModel(modelResult.data, [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], runId);
    const latest = await oneRow("runs", ownerId, runId);
    if (latest.cancel_requested_at || latest.status === "cancelled") return;
    await updateRow("runs", ownerId, runId, { status: "completed", output, completed_at: new Date().toISOString() });
  } catch (error) {
    if (!run) throw error;
    const latest = await oneRow("runs", ownerId, runId).catch(() => null);
    if (latest?.status === "cancelled") return;
    await updateRow("runs", ownerId, runId, { status: "failed", error: error instanceof Error ? error.message : "模型执行失败", completed_at: new Date().toISOString() });
  } finally {
    await releaseGlobalRunSlot(runId).catch(() => {});
  }
}

export async function executeSource(ownerId, projectId, sourceId) {
  return processSourceJob(ownerId, projectId, sourceId);
}

export async function dispatchRun(ownerId, runId) {
  if (process.env.QSTASH_TOKEN && process.env.PUBLIC_APP_URL) {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    await client.publishJSON({
      url: `${process.env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/jobs/execute`,
      body: { ownerId, runId }, retries: 2,
    });
    return "qstash";
  }
  if (String(process.env.ALLOW_SYNCHRONOUS_DEMO_RUNS).toLowerCase() === "true") {
    waitUntil(executeRun(ownerId, runId));
    return "vercel-wait-until";
  }
  throw new Error("任务调度服务尚未就绪，请联系管理员");
}

export async function dispatchSource(ownerId, projectId, sourceId) {
  if (process.env.QSTASH_TOKEN && process.env.PUBLIC_APP_URL) {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    await client.publishJSON({
      url: `${process.env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/jobs/source-process`,
      body: { ownerId, projectId, sourceId }, retries: 2,
    });
    return "qstash";
  }
  if (String(process.env.ALLOW_SYNCHRONOUS_DEMO_RUNS).toLowerCase() === "true") {
    waitUntil(executeSource(ownerId, projectId, sourceId));
    return "vercel-wait-until";
  }
  throw new Error("任务调度服务尚未就绪，请联系管理员");
}

export async function verifyQStash(req, rawBody) {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) throw Object.assign(new Error("任务验证服务尚未就绪"), { statusCode: 503 });
  const signature = req.headers["upstash-signature"];
  if (!signature) throw Object.assign(new Error("任务验证信息缺失"), { statusCode: 401 });
  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  const valid = await receiver.verify({ signature, body: rawBody });
  if (!valid) throw Object.assign(new Error("任务验证失败"), { statusCode: 401 });
}

export function contentHash(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
