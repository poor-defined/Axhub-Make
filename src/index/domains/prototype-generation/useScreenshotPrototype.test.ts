import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { toast, type Action } from 'sonner';
import { useScreenshotPrototype } from './useScreenshotPrototype';
import { runAcpPrototypeAgent } from './acpPrototypeAgentClient';
import { referenceRequest } from '../documentation/referencePagesClient';
import { ScreenshotPrototypeComposer } from '../../components/content/ScreenshotPrototypeComposer';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('../documentation/referencePagesClient', () => ({ referenceRequest: vi.fn(async () => ({ name: 'from-shot', filePath: 'content/prototypes/from-shot/index.tsx', displayName: '首页', prompt: 'brief', clientUrl: '/?p=from-shot' })) }));
vi.mock('./acpPrototypeAgentClient', () => ({ runAcpPrototypeAgent: vi.fn(async () => ({ status: 'done' })) }));
let view: ReactTestRenderer | undefined, api!: ReturnType<typeof useScreenshotPrototype>;
const request = { images: [{ name: 'home.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }] };
function Probe({ project, provider = 'acp:codex', onOpen = () => {}, onDone = async () => {}, autoOpen = false }: { project: string; provider?: string; onOpen?: () => void; onDone?: () => Promise<void>; autoOpen?: boolean }) {
  api = useScreenshotPrototype(project, { promptClient: provider as 'acp:codex', model: 'configured-model', onDone, onOpen, autoOpen }); return null;
}
afterEach(async () => { await act(async () => view?.unmount()); vi.clearAllMocks(); });
it('passes the actual screenshot bytes to the configured project AI', async () => {
  await act(async () => { view = create(React.createElement(Probe, { project: 'a' })); });
  await act(async () => { await api.generate(request); });
  expect(referenceRequest).toHaveBeenCalledWith('/api/prototypes/create-from-screenshot?projectId=a', expect.anything());
  expect(runAcpPrototypeAgent).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'a', provider: 'codex', model: 'configured-model', referenceImages: [request.images[0].dataUrl], prototypeDirectory: 'content/prototypes/from-shot/' }));
});
it('opens a completed resource only after refresh and only while its start page is still active', async () => {
  let finish!: () => void;
  const refresh = new Promise<void>(resolve => { finish = resolve; });
  const onOpen = vi.fn();
  await act(async () => { view = create(React.createElement(Probe, { project: 'a', onOpen, autoOpen: true, onDone: () => refresh })); });
  let running!: Promise<void>;
  await act(async () => { running = api.generate(request); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => { finish(); await running; });
  expect(onOpen).toHaveBeenCalledOnce();
});
it('checks AI configuration before creating files and prevents stale completion actions', async () => {
  await act(async () => { view = create(React.createElement(Probe, { project: 'a', provider: 'clipboard' })); });
  await act(async () => { await api.generate(request); });
  expect(api.state.phase).toBe('error'); expect(referenceRequest).not.toHaveBeenCalled();
  await act(async () => { api.reset(); view!.update(React.createElement(Probe, { project: 'a' })); });
  await act(async () => { await api.generate(request); });
  const action = vi.mocked(toast.success).mock.calls[0][1]!.action as Action;
  const open = vi.fn();
  await act(async () => view!.update(React.createElement(Probe, { project: 'b', onOpen: open })));
  action.onClick({} as React.MouseEvent<HTMLButtonElement>); expect(open).not.toHaveBeenCalled(); expect(api.state.phase).toBe('idle');
});
it('never initializes the next project composer with the previous project screenshots', async () => {
  function Workspace({ project }: { project: string }) {
    api = useScreenshotPrototype(project, { promptClient: 'acp:codex', onDone: async () => {}, onOpen: () => {} });
    return React.createElement(ScreenshotPrototypeComposer, { key: project, controller: api });
  }
  vi.mocked(runAcpPrototypeAgent).mockResolvedValueOnce({ status: 'error', error: 'disconnected' });
  await act(async () => { view = create(React.createElement(Workspace, { project: 'a' })); });
  await act(async () => { await api.generate(request); });
  expect(view!.root.findAllByType('img')).toHaveLength(1);
  await act(async () => view!.update(React.createElement(Workspace, { project: 'b' })));
  expect(view!.root.findAllByType('img')).toHaveLength(0);
});
