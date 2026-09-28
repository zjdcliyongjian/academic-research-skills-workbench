import { describe, it, expect, vi } from 'vitest';
import { translateExport, translationChunks } from '../cloud/export-translation.mjs';
const config = { model: 'test' };
const markerOf = messages => messages[1].content.match(/END_TRANSLATION_[0-9a-f-]+/)[0];
describe('English export translation', () => {
  it('splits long content without losing source characters', () => {
    const input = '# 研究\n' + '测试正文 [S1] 85%\n'.repeat(1000);
    const chunks = translationChunks(input);
    expect(chunks.join('')).toBe(input);
    expect(Math.max(...chunks.map(s => s.length))).toBeLessThanOrEqual(3001);
  });
  it('translates titles, content and pending labels through the selected model', async () => {
    const model = vi.fn(async (_config, messages) => `# Research\nPending verification [S1]: 85%\n${markerOf(messages)}`);
    const result = await translateExport('# 研究\n待核验 [S1]：85%', config, 'owner', model);
    expect(result).toBe('# Research\nPending verification [S1]: 85%');
    expect(model.mock.calls[0][0]).toBe(config);
    expect(model.mock.calls[0][3].rejectTruncation).toBe(true);
  });
  it('rejects missing models, truncation, untranslated output and dropped references', async () => {
    await expect(translateExport('研究', null, 'owner')).rejects.toThrow('系统设置');
    await expect(translateExport('研究', config, 'owner', async () => 'Partial')).rejects.toThrow('未完整');
    await expect(translateExport('研究', config, 'owner', async (_, messages) => '中文正文'.repeat(20) + '\n' + markerOf(messages))).rejects.toThrow('大量中文');
    await expect(translateExport('研究 [S1]', config, 'owner', async (_, messages) => 'Research\n' + markerOf(messages))).rejects.toThrow('遗漏引用');
  });
  it('does not silently return source text on model failure', async () => {
    await expect(translateExport('研究', config, 'owner', async () => { throw new Error('API unavailable'); })).rejects.toThrow('API unavailable');
  });
});
