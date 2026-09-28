import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../cloud/crypto.mjs';
import { buildChatPayload, callModel, listAvailableModels, extractModelText } from '../cloud/model-gateway.mjs';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
const models = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'];
const originalKey = process.env.BYOK_MASTER_KEY;
describe('Claude native Messages API', () => {
  beforeEach(() => { process.env.BYOK_MASTER_KEY = randomBytes(32).toString('base64'); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }), { status: 200 }))); });
  afterEach(() => { vi.unstubAllGlobals(); if (originalKey === undefined) delete process.env.BYOK_MASTER_KEY; else process.env.BYOK_MASTER_KEY = originalKey; });
  it.each(models)('routes %s with native authentication and system instructions', async model => {
    const config = { provider: 'anthropic', model, base_url: 'https://api.anthropic.com/v1', encrypted_api_key: encryptSecret('test-key') };
    expect(await callModel(config, [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Reply OK' }], 'test', { maxTokens: 128 })).toBe('OK');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers.Authorization).toBeUndefined();
    const payload = JSON.parse(init.body);
    expect(payload.system).toBe('Be concise.');
    expect(payload.messages).toEqual([{ role: 'user', content: 'Reply OK' }]);
    expect(payload.max_tokens).toBe(128);
    expect(payload).not.toHaveProperty('temperature');
  });
  it('has a default output limit for research runs and excludes thinking blocks', () => {
    expect(buildChatPayload({ provider: 'anthropic', model: models[0] }, [{ role: 'user', content: 'Research' }]).max_tokens).toBe(8192);
    expect(extractModelText({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Result' }] })).toBe('Result');
  });
  it('uses native headers for model discovery', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: models.map(id => ({ id })) })));
    expect(await listAvailableModels('https://api.anthropic.com/v1', 'test-key', 1000, 'anthropic')).toEqual(models);
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('test-key');
  });
  it('reports denied access without silently changing models', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 }));
    await expect(callModel({ provider: 'anthropic', model: models[0], base_url: 'https://api.anthropic.com/v1', encrypted_api_key: encryptSecret('test-key') }, [{ role: 'user', content: 'OK' }], 'denied')).rejects.toThrow('权限');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated translations', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Partial' }], stop_reason: 'max_tokens' })));
    await expect(callModel({ provider: 'anthropic', model: models[0], base_url: 'https://api.anthropic.com/v1', encrypted_api_key: encryptSecret('test-key') }, [{ role: 'user', content: 'Translate' }], 'truncated', { rejectTruncation: true })).rejects.toThrow('截断');
  });
});
