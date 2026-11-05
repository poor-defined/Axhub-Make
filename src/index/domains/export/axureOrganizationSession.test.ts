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
  it('captures without ever calling AI until the user explicitly requests organization', async () => {
    const { session, analyze, copy } = setup();
    await session.start(payload);
    expect(session.getState()).toMatchObject({ phase: 'captured', original: payload });
    expect(analyze).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    await session.organize();
    expect(session.getState().phase).toBe('ready');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('prepares a preview and only copies the organized tree on explicit confirmation', async () => {
    const { session, copy } = setup();
    await session.start(payload);
    await session.organize();
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
    await session.organize();
    expect(session.getState()).toMatchObject({ phase: 'error', error: 'AI unavailable', original: payload });
    expect(copy).not.toHaveBeenCalled();
    await session.copy('original');
    expect(copy.mock.calls[0][0]).toEqual(payload);
  });
  it('retries AI on the same snapshot without recapturing the page', async () => {
    const analyze = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(plan);
    const { session } = setup(analyze);
    await session.start(payload);
    await session.organize();
    await session.retry();
    expect(session.getState().phase).toBe('ready');
    expect(analyze.mock.calls[0][0]).toEqual(analyze.mock.calls[1][0]);
  });
  it('preserves the organized result after copy failure so retry does not call AI again', async () => {
    const { session, analyze, copy } = setup();
    copy.mockRejectedValueOnce(new Error('Bridge down'));
    await session.start(payload);
    await session.organize();
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
    await session.start(payload);
    const pending = session.organize();
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
    await session.start(payload);
    const pending = session.organize();
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
    await session.organize();
    expect(session.getState().phase).toBe('error');
    expect(session.getState().organized).toBeUndefined();
  });
  it('refines from the same original with accumulated requirements and the previous plan as reference', async () => {
    const analyze = vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce({ version: 1, renames: [{ id: 'b', name: 'btn_重置' }], groups: [] });
    const { session } = setup(analyze);
    await session.start(payload);
    await session.organize('组件名称使用中文');
    await session.organize('按钮增加 btn_ 前缀，取消上一次的分组');
    expect(analyze.mock.calls[1][0]).toEqual(analyze.mock.calls[0][0]);
    expect(analyze.mock.calls[1][2]).toEqual({ instructions: ['组件名称使用中文', '按钮增加 btn_ 前缀，取消上一次的分组'], previousPlan: plan });
    expect(session.getState()).toMatchObject({ version: 2, original: payload });
    expect(session.getState().organized?.scene.items[0].scene?.items.map((node) => node.name)).toEqual(['div', 'btn_重置']);
    expect(session.getState().turns?.map((turn) => turn.status)).toEqual(['done', 'done']);
  });
  it('preserves the last valid version on refinement failure and retries without duplicating requirements/history', async () => {
    const analyze = vi.fn().mockResolvedValueOnce(plan).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(plan);
    const { session, copy } = setup(analyze);
    await session.start(payload); await session.organize();
    const previous = structuredClone(session.getState().organized);
    await session.organize('统一前缀');
    expect(session.getState()).toMatchObject({ phase: 'error', organized: previous, version: 1 });
    expect(session.getState().turns).toHaveLength(2);
    await session.retry();
    expect(analyze.mock.calls[2][2]).toEqual(analyze.mock.calls[1][2]);
    expect(session.getState().turns).toHaveLength(2);
    expect(session.getState().version).toBe(2);
    await session.copy('organized'); expect(copy).toHaveBeenCalledTimes(1);
  });
  it('ignores duplicate submissions while AI is running and clears conversation for a new capture', async () => {
    const pending = deferred<typeof plan>();
    const analyze = vi.fn(() => pending.promise);
    const { session } = setup(analyze);
    await session.start(payload);
    const first = session.organize('中文命名');
    await session.organize('重复'); await session.retry();
    expect(analyze).toHaveBeenCalledTimes(1);
    await session.start(payload);
    pending.resolve(plan); await first;
    expect(session.getState()).toMatchObject({ phase: 'captured', turns: [], version: 0 });
  });
  it('keeps a failed rounds requirements when the user sends a new follow-up', async () => {
    const analyze = vi.fn().mockResolvedValueOnce(plan).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(plan);
    const { session } = setup(analyze);
    await session.start(payload); await session.organize('中文命名');
    await session.organize('按钮增加 btn_ 前缀');
    await session.organize('分组以业务模块命名');
    expect(analyze.mock.calls[2][2].instructions).toEqual(['中文命名', '按钮增加 btn_ 前缀', '分组以业务模块命名']);
  });
  it('marks interrupted AI as retryable when copying the original fails, and ignores its late result', async () => {
    const late = deferred<typeof plan>();
    const analyze = vi.fn().mockImplementationOnce(() => late.promise).mockResolvedValueOnce(plan);
    const { session, copy } = setup(analyze);
    copy.mockRejectedValueOnce(new Error('Bridge down'));
    await session.start(payload);
    const pending = session.organize('中文命名');
    await session.copy('original');
    expect(session.getState()).toMatchObject({ phase: 'error', error: 'Bridge down', turns: [{ status: 'error' }] });
    await session.retry();
    late.resolve(plan); await pending;
    expect(session.getState()).toMatchObject({ phase: 'ready', version: 1 });
    expect(session.getState().turns).toHaveLength(1);
  });
});
