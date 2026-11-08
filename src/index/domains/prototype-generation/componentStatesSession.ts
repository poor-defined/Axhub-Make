import { validateComponentStatesRequest, type ComponentStatesRequest } from '../../../common/componentStates';
export interface ComponentStatesPrototype { name: string; prompt: string; filePath: string; displayName: string; clientUrl: string }
export interface ComponentStatesState {
  phase: 'idle' | 'review' | 'preparing' | 'running' | 'done' | 'error';
  visible: boolean; projectId: string; request: ComponentStatesRequest | null;
  prepared: ComponentStatesPrototype | null; error: string; message: string;
}
export function createComponentStatesSession(dependencies: {
  prepare: (request: ComponentStatesRequest, projectId: string) => Promise<ComponentStatesPrototype>;
  run: (prepared: ComponentStatesPrototype, request: ComponentStatesRequest, projectId: string, progress: (message: string) => void) => Promise<void>;
  onDone: (prepared: ComponentStatesPrototype, projectId: string) => void | Promise<void>;
}) {
  const idle = (): ComponentStatesState => ({ phase: 'idle', visible: false, projectId: '', request: null, prepared: null, error: '', message: '' });
  let state = idle(), revision = 0, busy = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ComponentStatesState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { revision++; busy = false; state = idle(); listeners.forEach(listener => listener()); },
    open(projectId: string, input: unknown): boolean {
      if (!projectId || busy || (state.request && state.phase !== 'done')) return false;
      const request = { ...validateComponentStatesRequest(input), requestId: globalThis.crypto.randomUUID() };
      revision++; state = idle(); update({ projectId, request, phase: 'review', visible: true }); return true;
    },
    show() { if (state.request) update({ visible: true }); },
    close() { if (busy) update({ visible: false }); else { revision++; state = idle(); listeners.forEach(listener => listener()); } },
    edit(patch: Partial<Pick<ComponentStatesRequest, 'title' | 'layout'>> & { note?: string }) {
      if (busy || state.prepared || !state.request) return;
      update({ request: { ...state.request, ...patch, capture: { ...state.request.capture, ...(patch.note === undefined ? {} : { note: patch.note }) } }, error: '' });
    },
    async generate() {
      if (busy || !state.request) return;
      const current = revision, projectId = state.projectId;
      const request = state.request;
      busy = true;
      try {
        validateComponentStatesRequest(request);
        update({ phase: 'preparing', error: '', message: '准备独立原型和来源资料…' });
        const prepared = state.prepared || await dependencies.prepare(request, projectId);
        if (revision !== current) return;
        update({ prepared, phase: 'running', message: 'AI 正在生成组件的状态与说明…' });
        await dependencies.run(prepared, request, projectId, message => { if (revision === current) update({ message }); });
        if (revision !== current) return;
        update({ phase: 'done', message: 'AI 任务已完成，可打开新原型检查各状态。' });
        // A resource-list refresh failure is not a failed AI task: do not generate again.
        try { await dependencies.onDone(prepared, projectId); } catch { if (revision === current) update({ message: 'AI 任务已完成，资源列表刷新失败，可打开新原型或手动刷新。' }); }
      } catch (error) {
        if (revision === current) update({ phase: 'error', error: error instanceof Error ? error.message : '生成失败，请重试' });
      } finally { if (revision === current) busy = false; }
    },
  };
}
