import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAxureTreeOrganization } from './useAxureTreeOrganization';

const rect = { location: { x: 0, y: 0 }, size: { width: 80, height: 40 } };
const payload = { scene: { items: [{ id: 'page', name: '页面', itemType: 2, rect,
  scene: { items: [{ id: 'a', name: 'div', itemType: 1, rect }] } }] } };
const plan = { version: 1, renames: [{ id: 'a', name: '查询按钮' }], groups: [] };
afterEach(() => { vi.unstubAllGlobals(); });

describe('Axure organization hook lifecycle', () => {
  it('aborts stale responses on scope changes and iframe reloads, and removes its listener on unmount', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const frame = new EventTarget();
    const secondaryFrame = new EventTarget();
    const remove = vi.spyOn(frame, 'removeEventListener');
    const getPreviewIframe = () => frame as HTMLIFrameElement;
    const getPreviewIframes = () => [frame, secondaryFrame] as HTMLIFrameElement[];
    const copy = vi.fn(async () => {});
    let current!: ReturnType<typeof useAxureTreeOrganization>;
    function Probe({ scopeKey }: { scopeKey: string }) {
      current = useAxureTreeOrganization({ projectId: 'test', scopeKey, getPreviewIframe, getPreviewIframes, copy });
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Probe, { scopeKey: 'page-a' })); });
    let pending!: Promise<void>;
    await act(async () => { await current.session.start(payload); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { pending = current.session.organize('使用中文命名'); });
    expect(current.state.phase).toBe('analyzing');
    const signal = (fetchMock.mock.calls[0] as any)[1].signal as AbortSignal;
    await act(async () => { renderer.update(React.createElement(Probe, { scopeKey: 'page-b' })); });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(Response.json({ plan })); await pending; });
    expect(current.state.phase).toBe('idle');
    expect(copy).not.toHaveBeenCalled();

    await act(async () => { await current.session.start(payload); pending = current.session.organize(); });
    await act(async () => { secondaryFrame.dispatchEvent(new Event('load')); });
    await act(async () => { finish(Response.json({ plan })); await pending; });
    expect(current.state.phase).toBe('idle');
    await act(async () => { renderer.unmount(); });
    expect(remove).toHaveBeenCalledWith('load', expect.any(Function));
  });
  it('forwards the original snapshot with prior plan and cumulative naming rules on a follow-up', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const fetchMock = vi.fn(async () => Response.json({ plan }));
    vi.stubGlobal('fetch', fetchMock);
    const getPreviewIframe = () => null;
    const copy = vi.fn(async () => {});
    let current!: ReturnType<typeof useAxureTreeOrganization>;
    function Probe() {
      current = useAxureTreeOrganization({ projectId: 'test', scopeKey: 'test', getPreviewIframe, copy });
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Probe)); });
    await act(async () => { await current.session.start(payload); await current.session.organize('使用中文'); });
    await act(async () => { await current.session.organize('按钮加 btn_ 前缀'); });
    const body = JSON.parse((fetchMock.mock.calls[1] as any)[1].body);
    expect(body.context).toEqual({ instructions: ['使用中文', '按钮加 btn_ 前缀'], previousPlan: plan });
    expect(body.summary.nodes[1].name).toBe('div');
    await act(async () => { renderer.unmount(); });
  });
});
