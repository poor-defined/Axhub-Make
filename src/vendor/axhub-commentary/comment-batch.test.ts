import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeCommentScreenshots, createCommentBatchAction, type CommentListEntry } from '../../../vendor/axhub-commentary/src/core/editor/comment-batch';

afterEach(() => vi.unstubAllGlobals());

const element = (name: string) => ({ isConnected: true, outerHTML: `<section>${name}</section>` }) as Element;
function setup() {
  let scopeRevision = 1;
  const entries: CommentListEntry[] = ['first', 'second', 'unselected'].map(id => ({ id, label: id, note: `${id} note`, selector: `#${id}`, element: element(id) }));
  const send = vi.fn(async (_elements: Element[]) => {});
  const document = vi.fn(async () => true);
  const generate = vi.fn(async () => true);
  const capture = vi.fn(async () => ({ data: 'data:image/png;base64,cGlj', width: 100, height: 50, name: 'component.png' }));
  const compose = vi.fn(async () => 'data:image/png;base64,YmF0Y2g=');
  const run = createCommentBatchAction({ getEntries: () => entries, getScopeRevision: () => scopeRevision, send, document, generate, capture, compose, getSource: () => ({ title: 'Source', url: 'https://example.test/' }) });
  return { entries, send, document, generate, capture, compose, run, switchPage: () => { scopeRevision++; } };
}
describe('saved comment batch actions', () => {
  it('does not deliver old-page captures if a page switch happens during screenshot capture', async () => {
    const s = setup();
    s.capture.mockImplementationOnce(async () => { s.switchPage(); return { data: 'data:image/png;base64,cGlj', width: 100, height: 50, name: 'component.png' }; });
    await expect(s.run('document', ['first'])).rejects.toThrow('页面已切换');
    expect(s.document).not.toHaveBeenCalled();
  });
  it('sends exactly the selected IDs, deduplicates them and preserves saved comments', async () => {
    const s = setup();
    await s.run('send', ['second', 'first', 'second']);
    expect(s.send).toHaveBeenCalledWith([s.entries[1].element, s.entries[0].element]);
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.entries.map(entry => entry.note)).toEqual(['first note', 'second note', 'unselected note']);
  });
  it('opens documentation once with all selected screenshots and individual notes', async () => {
    const s = setup();
    await s.run('document', ['first', 'second']);
    expect(s.capture.mock.calls).toHaveLength(2);
    expect(s.compose).toHaveBeenCalledTimes(1);
    expect(s.document).toHaveBeenCalledTimes(1);
    expect(s.document).toHaveBeenCalledWith(expect.objectContaining({ note: expect.stringContaining('second note'), imageDataUrl: 'data:image/png;base64,YmF0Y2g=' }));
    expect(s.send).not.toHaveBeenCalled(); expect(s.generate).not.toHaveBeenCalled();
  });
  it('generates one prototype with all selected source HTML and can then independently introduce documentation', async () => {
    const s = setup();
    await s.run('generate', ['first', 'second']);
    expect(s.generate).toHaveBeenCalledTimes(1);
    expect(s.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceHtml: '<section>first</section>\n<section>second</section>', capture: expect.objectContaining({ note: expect.stringContaining('first note') }) }));
    expect(s.send).not.toHaveBeenCalled(); expect(s.document).not.toHaveBeenCalled();
    await s.run('document', ['first', 'second']);
    expect(s.document).toHaveBeenCalledTimes(1);
  });
  it.each(['send', 'generate', 'document'] as const)('rejects empty, missing or unavailable targets before %s side effects', async action => {
    const s = setup();
    await expect(s.run(action, [])).rejects.toThrow('请选择');
    await expect(s.run(action, ['missing'])).rejects.toThrow('失效');
    s.entries[1].element = null;
    await expect(s.run(action, ['first', 'second'])).rejects.toThrow('失效');
    expect(s.send).not.toHaveBeenCalled(); expect(s.capture).not.toHaveBeenCalled();
  });
  it('keeps comments retryable after capture failure or host rejection', async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(new Error('capture failed'));
    await expect(s.run('document', ['first'])).rejects.toThrow('capture failed');
    expect(s.document).not.toHaveBeenCalled();
    s.document.mockResolvedValueOnce(false);
    await expect(s.run('document', ['first'])).rejects.toThrow('未能打开');
    await s.run('document', ['first']);
    expect(s.entries).toHaveLength(3);
  });
  it('prevents duplicate submissions and unlocks after completion', async () => {
    const s = setup(); let resolve!: () => void;
    s.send.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const first = s.run('send', ['first']);
    await expect(s.run('document', ['second'])).rejects.toThrow('正在处理');
    resolve(); await first;
    await s.run('document', ['second']);
    expect(s.document).toHaveBeenCalledTimes(1);
  });
  it('rejects overlong combined notes without losing information', async () => {
    const s = setup(); s.entries[0].note = 'a'.repeat(8000);
    await expect(s.run('document', ['first', 'second'])).rejects.toThrow('过长');
    expect(s.capture).not.toHaveBeenCalled();
  });
});

describe('batch screenshot composition', () => {
  it('draws every real component screenshot with matching numbers and bounds the contact sheet size', async () => {
    const context = { scale: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), fillStyle: '', font: '' };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => 'data:image/png;base64,YmF0Y2g=') };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('Image', class {
      naturalWidth = 2000; naturalHeight = 12000; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const result = await composeCommentScreenshots(['Header', 'Footer'].map(label => ({ label, screenshot: { data: 'data:image/png;base64,cGlj', width: 2000, height: 12000, name: 'component.png' } })));
    expect(result).toBe('data:image/png;base64,YmF0Y2g=');
    expect(canvas.width).toBeLessThanOrEqual(1440); expect(canvas.height).toBeLessThanOrEqual(8192);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.fillText.mock.calls.map(call => call[0])).toEqual(['1. Header', '2. Footer']);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });
  it('rejects image decode failure instead of silently omitting a selected component', async () => {
    vi.stubGlobal('Image', class {
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    await expect(composeCommentScreenshots([{ label: 'Header', screenshot: { data: 'broken', width: 10, height: 10, name: 'component.png' } }])).rejects.toThrow('截图读取失败');
  });
});
