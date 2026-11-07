import { describe, expect, it, vi } from 'vitest';
import { createDocumentationSession } from './documentationSession';
const capture = {
  imageDataUrl: 'data:image/png;base64,aGVsbG8=',
  note: '',
  component: { name: '登录面板' },
  source: { title: '页面', url: 'https://example.test' },
};
describe('component documentation session', () => {
  it('requires a target PRD before invoking AI, including for an empty note', async () => {
    const request = vi.fn();
    const session = createDocumentationSession(request);
    session.open('p', capture);
    await session.generate();
    expect(request).not.toHaveBeenCalled();
    expect(session.getState().phase).toBe('captured');
  });
  it('waits for a manual generation, preserves edits, and appends only after confirmation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ title: '登录', description: '说明' })
      .mockResolvedValueOnce({ assetPath: 'assets/a.png' });
    const session = createDocumentationSession(request);
    session.open('p', capture);
    expect(request).not.toHaveBeenCalled();
    session.selectDocument('docs/prd.md');
    await session.generate();
    session.edit({ description: '修改后的说明' });
    await session.append();
    expect(request.mock.calls[1][0]).toBe('/api/component-documentation/append');
    expect(request.mock.calls[1][1]).toMatchObject({
      projectId: 'p',
      documentPath: 'docs/prd.md',
      description: '修改后的说明',
      capture,
    });
    expect(session.getState().phase).toBe('saved');
  });
  it('ignores late AI responses after close or a project switch', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const session = createDocumentationSession(request);
    session.open('p', capture);
    session.selectDocument('docs/prd.md');
    const work = session.generate();
    session.close();
    resolve({ title: '旧', description: '旧' });
    await work;
    expect(session.getState().phase).toBe('idle');
  });
  it('keeps the existing preview when regeneration fails and blocks saving without a chosen PRD', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ title: '登录', description: '说明' })
      .mockRejectedValueOnce(new Error('AI断开'));
    const session = createDocumentationSession(request);
    session.open('p', capture);
    session.selectDocument('docs/prd.md');
    await session.generate();
    await session.generate('简洁');
    expect(session.getState()).toMatchObject({
      phase: 'ready',
      description: '说明',
      error: 'AI断开',
    });
    session.selectDocument('');
    await session.append();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
