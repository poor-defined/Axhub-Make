import { describe, expect, it, vi } from 'vitest';
import { createAxureOrganizationSession } from './axureOrganizationSession';

const rect = { location: { x: 0, y: 0 }, size: { width: 80, height: 30 } };
const payload = { imageMap: { hash: 'image' }, scene: { items: [{ id: 'page', name: '页面', itemType: 2, rect,
  scene: { items: ['a', 'b'].map((id) => ({ id, name: 'div', itemType: 1, rect })) } }] } };
const plan = { version: 1, renames: [{ id: 'a', name: '查询' }], groups: [{ id: 'ai-group-1', name: '查询区', parentId: 'page', childIds: ['a', 'b'] }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(analyze = vi.fn(async () => plan)) {
  const copy = vi.fn(async (_payload: unknown, _signal: AbortSignal) => {});
  const session = createAxureOrganizationSession({ analyze, copy, onChange: vi.fn() });
  session.setScope('project:page1');
  return { session, analyze, copy };
}

describe('Axure organization session', () => {
  it('always offers a visible confirmation step even when automatic AI is disabled', async () => {
    const { session, analyze, copy } = setup();
    await session.start(payload, false);
    expect(session.getState()).toMatchObject({ phase: 'captured', original: payload });
    expect(analyze).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    await session.retry();
    expect(session.getState().phase).toBe('ready');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('prepares a preview and only copies the organized tree on explicit confirmation', async () => {
    const { session, copy } = setup();
    await session.start(payload);
    expect(session.getState().phase).toBe('ready');
    expect(copy).not.toHaveBeenCalled();
    await session.copy('organized');
    expect(copy.mock.calls[0][0]).toMatchObject({ imageMap: payload.imageMap });
    expect((copy.mock.calls[0][0] as any).scene.items[0].scene.items[0].name).toBe('查询区');
    expect(session.getState().phase).toBe('idle');
  });
  it('retains original structure on AI failure and supports explicit original copy', async () => {
    const analyze = vi.fn(async () => { throw new Error('AI unavailable'); });
    const { session, copy } = setup(analyze);
    await session.start(payload);
    expect(session.getState()).toMatchObject({ phase: 'error', error: 'AI unavailable', original: payload });
    expect(copy).not.toHaveBeenCalled();
    await session.copy('original');
    expect(copy.mock.calls[0][0]).toEqual(payload);
  });
  it('retries AI on the same snapshot without recapturing the page', async () => {
    const analyze = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(plan);
    const { session } = setup(analyze);
    await session.start(payload);
    await session.retry();
    expect(session.getState().phase).toBe('ready');
    expect(analyze.mock.calls[0][0]).toEqual(analyze.mock.calls[1][0]);
  });
  it('preserves the organized result after copy failure so retry does not call AI again', async () => {
    const { session, analyze, copy } = setup();
    copy.mockRejectedValueOnce(new Error('Bridge down'));
    await session.start(payload);
    await session.copy('organized');
    expect(session.getState()).toMatchObject({ phase: 'ready', error: 'Bridge down' });
    await session.copy('organized');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(2);
  });
  it('cancels and ignores late AI results when the project or page changes', async () => {
    const late = deferred<typeof plan>();
    const analyze = vi.fn(() => late.promise);
    const { session, copy } = setup(analyze);
    const pending = session.start(payload);
    session.setScope('project:page2');
    expect((analyze.mock.calls[0] as any)[1].aborted).toBe(true);
    late.resolve(plan);
    await pending;
    expect(session.getState().phase).toBe('idle');
    await session.copy('organized');
    expect(copy).not.toHaveBeenCalled();
  });
  it('can copy the original while AI is pending and ignores its eventual result', async () => {
    const late = deferred<typeof plan>();
    const { session, copy } = setup(vi.fn(() => late.promise));
    const pending = session.start(payload);
    await session.copy('original');
    late.resolve(plan);
    await pending;
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).toEqual(payload);
    expect(session.getState().phase).toBe('idle');
  });
  it('rejects unsafe AI output without exposing a copyable organized result', async () => {
    const { session } = setup(vi.fn(async () => ({ ...plan, groups: [{ ...plan.groups[0], childIds: ['b', 'a'] }] })));
    await session.start(payload);
    expect(session.getState().phase).toBe('error');
    expect(session.getState().organized).toBeUndefined();
  });
});
