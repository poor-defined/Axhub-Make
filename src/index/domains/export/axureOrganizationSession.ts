import { applyAxureTreePlan, buildAxureTreeSummary, validateAxureTreePlan,
  type AxureTreePayload, type AxureTreePlan, type AxureTreeSummary } from '../../../common/axureTreeOrganization';

export interface AxureOrganizationState {
  phase: 'idle' | 'captured' | 'analyzing' | 'ready' | 'error' | 'copying';
  original?: AxureTreePayload;
  organized?: AxureTreePayload;
  plan?: AxureTreePlan;
  error?: string;
}
interface SessionOptions {
  analyze: (summary: AxureTreeSummary, signal: AbortSignal) => Promise<unknown>;
  copy: (payload: AxureTreePayload, signal: AbortSignal) => Promise<void>;
  onChange: (state: AxureOrganizationState) => void;
}

/** One immutable capture per session. Retry/copy never recaptures or reruns AI implicitly. */
export function createAxureOrganizationSession(options: SessionOptions) {
  let state: AxureOrganizationState = { phase: 'idle' };
  let scope = '';
  let sequence = 0;
  let controller: AbortController | null = null;
  const publish = (next: AxureOrganizationState) => { state = next; options.onChange(state); };
  function abort() { sequence += 1; controller?.abort(); controller = null; }
  function cancel() { abort(); publish({ phase: 'idle' }); }
  async function analyze(original: AxureTreePayload) {
    abort();
    const token = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    publish({ phase: 'analyzing', original });
    try {
      const plan = validateAxureTreePlan(await options.analyze(buildAxureTreeSummary(original), signal));
      if (token !== sequence || signal.aborted) return;
      const organized = applyAxureTreePlan(original, plan);
      publish({ phase: 'ready', original, organized, plan });
    } catch (error) {
      if (token !== sequence || signal.aborted) return;
      publish({ phase: 'error', original, error: error instanceof Error ? error.message : 'AI 整理失败' });
    }
  }
  return {
    getState: () => state,
    getScope: () => scope,
    setScope(next: string) { if (scope !== next) { scope = next; cancel(); } },
    cancel,
    start(payload: AxureTreePayload, autoAnalyze = true) {
      const original = structuredClone(payload);
      if (autoAnalyze) return analyze(original);
      abort();
      publish({ phase: 'captured', original });
      return Promise.resolve();
    },
    retry() { return state.original && state.phase !== 'copying' ? analyze(state.original) : Promise.resolve(); },
    async copy(version: 'original' | 'organized') {
      if (state.phase === 'copying') return;
      const payload = version === 'original' ? state.original : state.organized;
      if (!payload) return;
      const previous = state;
      abort();
      const token = sequence;
      controller = new AbortController();
      const signal = controller.signal;
      publish({ ...previous, phase: 'copying', error: undefined });
      try {
        await options.copy(payload, signal);
        if (token === sequence && !signal.aborted) publish({ phase: 'idle' });
      } catch (error) {
        if (token !== sequence || signal.aborted) return;
        publish({ ...previous, phase: previous.organized ? 'ready' : 'error',
          error: error instanceof Error ? error.message : '复制失败，请重试' });
      }
    },
  };
}
