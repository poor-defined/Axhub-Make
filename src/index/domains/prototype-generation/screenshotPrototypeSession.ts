import { validateScreenshotPrototypeRequest, type ScreenshotPrototypeRequest } from '../../../common/screenshotPrototype';
export interface ScreenshotPrototype { name: string; prompt: string; filePath: string; displayName: string; clientUrl: string }
export interface ScreenshotPrototypeState {
  phase: 'idle' | 'preparing' | 'running' | 'done' | 'error';
  projectId: string; request: ScreenshotPrototypeRequest | null;
  prepared: ScreenshotPrototype | null; error: string; message: string;
}
export function createScreenshotPrototypeSession(dependencies: {
  prepare: (request: ScreenshotPrototypeRequest, projectId: string) => Promise<ScreenshotPrototype>;
  run: (prepared: ScreenshotPrototype, request: ScreenshotPrototypeRequest, projectId: string, progress: (message: string) => void) => Promise<void>;
  onDone: (prepared: ScreenshotPrototype, projectId: string) => void | Promise<void>;
}) {
  const idle = (): ScreenshotPrototypeState => ({ phase: 'idle', projectId: '', request: null, prepared: null, error: '', message: '' });
  let state = idle(), revision = 0, busy = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ScreenshotPrototypeState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const execute = async () => {
    if (busy || !state.request || state.phase === 'done') return;
    const current = revision, projectId = state.projectId, request = state.request;
    busy = true;
    try {
      update({ phase: 'preparing', error: '', message: '正在准备新原型和截图…' });
      const prepared = state.prepared || await dependencies.prepare(request, projectId);
      if (revision !== current) return;
      update({ prepared, phase: 'running', message: 'AI 正在识别截图并生成线框原型…' });
      await dependencies.run(prepared, request, projectId, message => { if (revision === current) update({ message }); });
      if (revision !== current) return;
      let message = '原型已生成，可打开检查和编辑。';
      try { await dependencies.onDone(prepared, projectId); }
      catch { message = '原型已生成，资源列表刷新失败，请打开原型或手动刷新。'; }
      if (revision === current) update({ phase: 'done', message });
    } catch (error) {
      if (revision === current) update({ phase: 'error', error: error instanceof Error ? error.message : '生成失败，请重试' });
    } finally { if (revision === current) busy = false; }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { revision++; busy = false; state = idle(); listeners.forEach(listener => listener()); },
    async generate(projectId: string, input: unknown) {
      if (busy || !projectId || state.phase !== 'idle') return;
      try {
        const request = { ...validateScreenshotPrototypeRequest(input), requestId: globalThis.crypto.randomUUID() };
        revision++; update({ request, projectId });
      } catch (error) { update({ phase: 'error', error: error instanceof Error ? error.message : '截图无效' }); return; }
      await execute();
    },
    async retry() { if (state.phase === 'error') await execute(); },
  };
}
