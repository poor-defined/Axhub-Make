import { AXURE_ORGANIZATION_LIMITS, applyAxureTreePlan, buildAxureTreeSummary, validateAxureTreePlan, validateAxureOrganizationContext,
  type AxureOrganizationContext, type AxureTreePayload, type AxureTreePlan, type AxureTreeSummary } from '../../../common/axureTreeOrganization';
import { validateAxurePrdMarkers } from '../../../common/axurePrdMarkers';

export interface AxureOrganizationTurn {
  instruction: string;
  status: 'pending' | 'done' | 'error';
  summary?: string;
}
export interface AxureOrganizationState {
  phase: 'idle' | 'captured' | 'analyzing' | 'ready' | 'error' | 'copying';
  original?: AxureTreePayload;
  organized?: AxureTreePayload;
  plan?: AxureTreePlan;
  instructions?: string[];
  turns?: AxureOrganizationTurn[];
  version?: number;
  error?: string;
}
interface SessionOptions {
  analyze: (summary: AxureTreeSummary, signal: AbortSignal, context: AxureOrganizationContext) => Promise<unknown>;
  copy: (payload: AxureTreePayload, signal: AbortSignal) => Promise<void>;
  onChange: (state: AxureOrganizationState) => void;
}
interface OrganizationRequest { context: AxureOrganizationContext; turns: AxureOrganizationTurn[] }

/** Immutable capture; AI and every subsequent refinement require an explicit user action. */
export function createAxureOrganizationSession(options: SessionOptions) {
  let state: AxureOrganizationState = { phase: 'idle' };
  let scope = '';
  let sequence = 0;
  let controller: AbortController | null = null;
  let lastRequest: OrganizationRequest | undefined;
  const publish = (next: AxureOrganizationState) => { state = next; options.onChange(state); };
  function abort() { sequence += 1; controller?.abort(); controller = null; }
  function cancel() { abort(); lastRequest = undefined; publish({ phase: 'idle' }); }
  const busy = () => state.phase === 'analyzing' || state.phase === 'copying';
  async function analyze(request: OrganizationRequest) {
    if (!state.original || busy()) return;
    abort();
    const previous = state;
    const original = state.original;
    const token = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    const finishTurn = (turn: AxureOrganizationTurn) => [...request.turns.slice(0, -1), turn];
    const instruction = request.turns[request.turns.length - 1].instruction;
    let context: AxureOrganizationContext | undefined;
    publish({ ...previous, phase: 'analyzing', turns: finishTurn({ instruction, status: 'pending' }), error: undefined });
    try {
      const summary = buildAxureTreeSummary(original);
      context = validateAxureOrganizationContext(request.context, summary);
      publish({ ...state, instructions: context.instructions });
      const plan = validateAxureTreePlan(await options.analyze(summary, signal, context));
      validateAxurePrdMarkers(summary, plan);
      if (token !== sequence || signal.aborted) return;
      const organized = applyAxureTreePlan(original, plan);
      const version = (previous.version || 0) + 1;
      publish({ ...previous, phase: 'ready', original, organized, plan, version, instructions: context.instructions, error: undefined,
        turns: finishTurn({ instruction, status: 'done', summary: `第 ${version} 版：${plan.renames.length} 个重命名，${plan.groups.length} 个分组` }) });
    } catch (error) {
      if (token !== sequence || signal.aborted) return;
      const message = error instanceof Error ? error.message : 'AI 整理失败';
      publish({ ...previous, phase: 'error', instructions: context?.instructions || previous.instructions,
        error: message, turns: finishTurn({ instruction, status: 'error', summary: message }) });
    }
  }
  async function organize(instruction = '') {
    if (!state.original || busy()) return;
    const content = instruction.trim();
    const request: OrganizationRequest = {
      context: { instructions: [...(state.instructions || []), ...(content ? [content] : [])], ...(state.plan ? { previousPlan: state.plan } : {}) },
      turns: [...(state.turns || []).slice(1 - AXURE_ORGANIZATION_LIMITS.instructions), { instruction: content || '按业务含义整理组件树', status: 'pending' }],
    };
    lastRequest = request;
    await analyze(request);
  }
  return {
    getState: () => state,
    getScope: () => scope,
    setScope(next: string) { if (scope !== next) { scope = next; cancel(); } },
    cancel,
    start(payload: AxureTreePayload) {
      abort(); lastRequest = undefined;
      publish({ phase: 'captured', original: structuredClone(payload), instructions: [], turns: [], version: 0 });
      return Promise.resolve();
    },
    organize,
    retry() { return busy() ? Promise.resolve() : lastRequest ? analyze(lastRequest) : organize(); },
    async copy(version: 'original' | 'organized') {
      if (state.phase === 'copying') return;
      const payload = version === 'original' ? state.original : state.organized;
      if (!payload) return;
      const previous = state.phase === 'analyzing'
        ? { ...state, turns: state.turns?.map((turn) => turn.status === 'pending'
          ? { ...turn, status: 'error' as const, summary: '本次整理已取消，可重试。' } : turn) }
        : state;
      abort();
      const token = sequence;
      controller = new AbortController();
      const signal = controller.signal;
      publish({ ...previous, phase: 'copying', error: undefined });
      try {
        await options.copy(payload, signal);
        if (token === sequence && !signal.aborted) cancel();
      } catch (error) {
        if (token !== sequence || signal.aborted) return;
        publish({ ...previous, phase: previous.organized ? 'ready' : 'error',
          error: error instanceof Error ? error.message : '复制失败，请重试' });
      }
    },
  };
}
