import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../cloud/repository.mjs', async (original) => ({ ...await original(), authenticate: vi.fn(), oneRow: vi.fn() }));
vi.mock('../cloud/runner.mjs', async (original) => ({ ...await original(), enforceRateLimit: vi.fn() }));
import { authenticate, oneRow } from '../cloud/repository.mjs';
import { handleCloudRequest } from '../cloud/handler.mjs';

async function preview() {
  const res = { statusCode: 0, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await handleCloudRequest({ method: 'GET', url: '/api/projects/p1/versions/v1', query: { path: 'projects/p1/versions/v1' }, headers: {} }, res);
  return res;
}
describe('formal version preview', () => {
  beforeEach(() => { vi.resetAllMocks(); authenticate.mockResolvedValue({ id: 'owner1' }); });
  it('returns the immutable version content, scoped to owner and project', async () => {
    oneRow.mockImplementation(async (table) => table === 'projects' ? { id: 'p1' } : { project_id: 'p1', content: '# Saved version' });
    const res = await preview();
    expect(res.statusCode).toBe(200);
    expect(res.body.content).toBe('# Saved version');
    expect(oneRow).toHaveBeenCalledWith('stage_versions', 'owner1', 'v1');
  });
  it('rejects a version from another project', async () => {
    oneRow.mockImplementation(async (table) => table === 'projects' ? { id: 'p1' } : { project_id: 'p2', content: 'private' });
    const res = await preview();
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('private');
  });
  it('requires authentication', async () => {
    authenticate.mockRejectedValue(Object.assign(new Error('请先登录'), { statusCode: 401 }));
    expect((await preview()).statusCode).toBe(401);
    expect(oneRow).not.toHaveBeenCalled();
  });
});
