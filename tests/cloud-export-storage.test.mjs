import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../cloud/repository.mjs', async (original) => ({ ...await original(), authenticate: vi.fn(), oneRow: vi.fn(), listRows: vi.fn(), insertRow: vi.fn(), adminClient: vi.fn() }));
vi.mock('../cloud/runner.mjs', async (original) => ({ ...await original(), enforceRateLimit: vi.fn() }));
vi.mock('../cloud/export-translation.mjs', () => ({ translateExport: vi.fn() }));
import { translateExport } from '../cloud/export-translation.mjs';
import { authenticate, oneRow, listRows, insertRow, adminClient } from '../cloud/repository.mjs';
import { handleCloudRequest } from '../cloud/handler.mjs';

const upload = vi.fn();
const download = vi.fn();
async function request(method, suffix = '', body) {
  const headers = {};
  const res = { statusCode: 0, setHeader(k, v) { headers[k] = v; }, end(v) { this.body = v; }, headers };
  await handleCloudRequest({ method, url: `/api/projects/p1/exports${suffix}`, query: { path: `projects/p1/exports${suffix.split('?')[0]}` }, headers: {}, body }, res);
  return res;
}
describe('cloud export storage names', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authenticate.mockResolvedValue({ id: 'owner1' });
    oneRow.mockResolvedValue({ id: 'p1', name: '中文课题：多模态研究 🔬', goal: '测试' });
    listRows.mockImplementation(async table => table === 'stage_versions' ? [{ status: 'active', stage: 'brief', version_number: 1, adopted_at: '2026-09-21', content: '已采用内容' }] : [{ id: 's1', status: 'content-verified', title: '测试来源' }]);
    insertRow.mockImplementation(async (_table, _owner, row) => ({ id: 'e1', ...row }));
    upload.mockResolvedValue({ error: null });
    adminClient.mockReturnValue({ storage: { from: () => ({ upload, download }) } });
  });
  it.each([['markdown','md'],['docx','docx'],['latex','tex'],['bibtex','bib'],['package','zip']])('uses an ASCII key for %s while retaining the Chinese download name', async (format, ext) => {
    const res = await request('POST', '', { format });
    expect(res.statusCode).toBe(201);
    const key = upload.mock.calls[0][0];
    expect(key).toMatch(new RegExp(`^owner1/p1/exports/[0-9a-f-]{36}\\.${ext}$`));
    const row = insertRow.mock.calls[0][2];
    expect(row.name).toContain('中文课题');
    expect(row.blob_url).toBe(key);
    expect(row.name.endsWith(`.${ext}`)).toBe(true);
  });
  it('uses unique keys even for repeated same-millisecond exports', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000);
    try {
      await request('POST', '', { format: 'markdown' });
      await request('POST', '', { format: 'markdown' });
      expect(upload.mock.calls[0][0]).not.toBe(upload.mock.calls[1][0]);
    } finally { vi.restoreAllMocks(); }
  });
  it('downloads by stored key with an encoded Chinese filename', async () => {
    oneRow.mockImplementation(async table => table === 'projects' ? { id: 'p1' } : { project_id: 'p1', blob_url: 'owner1/p1/exports/id.md', name: '中文研究.md', format: 'markdown' });
    download.mockResolvedValue({ data: new Blob(['研究正文']), error: null });
    const res = await request('GET', '/download?path=e1');
    expect(res.statusCode).toBe(200);
    expect(download).toHaveBeenCalledWith('owner1/p1/exports/id.md');
    expect(res.headers['Content-Disposition']).toContain(encodeURIComponent('中文研究.md'));
    expect(res.body.toString()).toBe('研究正文');
  });
  it.each(['markdown', 'docx'])('uses translated content for both %s file and preview', async format => {
    translateExport.mockResolvedValue('# English research plan\nPending verification [S1].');
    const res = await request('POST', '', { format, language: 'en' });
    expect(res.statusCode).toBe(201);
    expect(translateExport.mock.calls[0][0]).toContain('中文课题');
    const row = insertRow.mock.calls[0][2];
    expect(row.preview_text).toBe('# English research plan\nPending verification [S1].');
    expect(row.name).toMatch(/^Research-Plan-English-/);
    if (format === 'markdown') expect(upload.mock.calls[0][1].toString()).toBe(row.preview_text);
    else {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(upload.mock.calls[0][1]);
      const xml = await zip.file('word/document.xml').async('string');
      expect(xml).toContain('English research plan');
      expect(xml).not.toContain('中文课题');
    }
  });
  it('never saves an English-labelled file if translation fails', async () => {
    translateExport.mockRejectedValue(new Error('Translation failed'));
    expect((await request('POST', '', { format: 'markdown', language: 'en' })).statusCode).toBe(500);
    expect(upload).not.toHaveBeenCalled();
    expect(insertRow).not.toHaveBeenCalled();
  });
  it.each(['zh', 'en'])('packages matching Markdown and Word manuscripts plus README (%s)', async language => {
    translateExport.mockResolvedValue('# English plan\nPending verification.');
    expect((await request('POST', '', { format: 'package', language })).statusCode).toBe(201);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(upload.mock.calls[0][1]);
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(3);
    const mdName = names.find(name => name.endsWith('.md'));
    const docName = names.find(name => name.endsWith('.docx'));
    expect(mdName.slice(0, -3)).toBe(docName.slice(0, -5));
    const md = await zip.file(mdName).async('string');
    const doc = await JSZip.loadAsync(await zip.file(docName).async('nodebuffer'));
    const xml = await doc.file('word/document.xml').async('string');
    expect(md).toContain(language === 'en' ? 'English plan' : '已采用内容');
    expect(xml).toContain(language === 'en' ? 'English plan' : '已采用内容');
    expect(await zip.file('README.txt').async('string')).toContain('Word');
    expect(insertRow.mock.calls[0][2].preview_text).toContain('Word');
    expect(translateExport).toHaveBeenCalledTimes(language === 'en' ? 1 : 0);
  });
});
