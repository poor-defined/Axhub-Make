import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useComponentStates } from './useComponentStates';
import { runAcpPrototypeAgent } from './acpPrototypeAgentClient';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('../documentation/referencePagesClient', () => ({ referenceRequest: vi.fn(async () => ({ name: 'new-states', filePath: 'src/prototypes/new-states/index.tsx', displayName: 'States', prompt: 'states', clientUrl: 'http://localhost/' })) }));
vi.mock('./acpPrototypeAgentClient', () => ({ runAcpPrototypeAgent: vi.fn(async () => ({ status: 'done' })) }));
let view: ReactTestRenderer | undefined, api!: ReturnType<typeof useComponentStates>;
function Probe(props: { project: string; onOpen: () => void; onDone: () => Promise<void> }) { api = useComponentStates(props.project, { promptClient: 'acp:codex', onDone: props.onDone, onOpen: props.onOpen }); return null; }
const request = { title: 'States', layout: 'overview', capture: { imageDataUrl: 'data:image/png;base64,aGVsbG8=', note: '登录和未登录', component: { name: 'Header' }, source: { title: 'Home', url: 'http://localhost/' } } };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('window', new EventTarget()); });
afterEach(async () => { await act(async () => view?.unmount()); vi.unstubAllGlobals(); });
it('cannot open an old project prototype through a completion notification after switching projects', async () => {
  const openA = vi.fn(), openB = vi.fn(), onDone = vi.fn(async () => {});
  await act(async () => { view = create(React.createElement(Probe, { project: 'a', onOpen: openA, onDone })); });
  await act(async () => { api.session.open('a', request); await api.session.generate(); });
  const action = vi.mocked(toast.success).mock.calls[0][1]!.action as { onClick: () => void };
  await act(async () => view!.update(React.createElement(Probe, { project: 'b', onOpen: openB, onDone })));
  action.onClick(); expect(openA).not.toHaveBeenCalled(); expect(openB).not.toHaveBeenCalled();
});
it('does not publish a stale success notification when a project switches during resource refresh', async () => {
  let resolve!: () => void;
  const refresh = new Promise<void>(r => { resolve = r; });
  await act(async () => { view = create(React.createElement(Probe, { project: 'a', onOpen: vi.fn(), onDone: () => refresh })); });
  let running!: Promise<void>;
  await act(async () => { api.session.open('a', request); running = api.session.generate(); await new Promise(r => setTimeout(r, 0)); });
  await act(async () => view!.update(React.createElement(Probe, { project: 'b', onOpen: vi.fn(), onDone: async () => {} })));
  await act(async () => { resolve(); await running; });
  expect(toast.success).not.toHaveBeenCalled();
});
it('keeps a background task discoverable and surfaces a recoverable failure', async () => {
  let finish!: (value: { status: 'error'; error: string }) => void;
  vi.mocked(runAcpPrototypeAgent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { view = create(React.createElement(Probe, { project: 'a', onOpen: vi.fn(), onDone: async () => {} })); });
  let running!: Promise<void>;
  await act(async () => { api.session.open('a', request); running = api.session.generate(); await new Promise(r => setTimeout(r, 0)); });
  await act(async () => api.session.close());
  expect(toast.loading).toHaveBeenCalled();
  await act(async () => { finish({ status: 'error', error: '连接中断' }); await running; });
  expect(api.state.phase).toBe('error');
  const action = vi.mocked(toast.error).mock.calls[0][1]!.action as { onClick: () => void };
  await act(async () => action.onClick());
  expect(api.state.visible).toBe(true);
});
