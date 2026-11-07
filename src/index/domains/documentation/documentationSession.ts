import type { ComponentDocumentationCapture } from '../../../common/componentDocumentation';
export interface DocumentationState {
  phase: 'idle' | 'captured' | 'generating' | 'ready' | 'saving' | 'saved';
  projectId?: string;
  capture?: ComponentDocumentationCapture;
  documentPath: string;
  title: string;
  description: string;
  error?: string;
}
export type DocumentationRequest = (
  path: string,
  body: unknown,
  signal: AbortSignal,
) => Promise<any>;
export function createDocumentationSession(request: DocumentationRequest) {
  let state: DocumentationState = { phase: 'idle', documentPath: '', title: '', description: '' };
  let revision = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (next: Partial<DocumentationState>) => {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  };
  const cancel = () => {
    revision++;
    controller?.abort();
    controller = undefined;
  };
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    open(projectId: string, capture: ComponentDocumentationCapture) {
      cancel();
      state = {
        phase: 'captured',
        projectId,
        capture,
        documentPath: '',
        title: '',
        description: '',
      };
      update({});
    },
    close() {
      cancel();
      state = { phase: 'idle', documentPath: '', title: '', description: '' };
      update({});
    },
    selectDocument(documentPath: string) {
      if (state.phase !== 'saving') update({ documentPath, error: undefined });
    },
    edit(value: { title?: string; description?: string }) {
      if (!['generating', 'saving'].includes(state.phase)) update({ ...value, error: undefined });
    },
    async generate(instruction = '') {
      if (
        !state.capture ||
        !state.documentPath ||
        ['generating', 'saving', 'saved'].includes(state.phase)
      )
        return;
      cancel();
      const turn = revision;
      controller = new AbortController();
      const previousDescription = state.description;
      update({ phase: 'generating', error: undefined });
      try {
        const result = await request(
          '/api/component-documentation/generate',
          {
            projectId: state.projectId,
            capture: state.capture,
            instruction,
            previousDescription,
          },
          controller.signal,
        );
        if (turn !== revision) return;
        if (
          typeof result.title !== 'string' ||
          typeof result.description !== 'string' ||
          !result.description.trim()
        )
          throw new Error('AI 返回的图文说明无效，请重试');
        update({ phase: 'ready', title: result.title, description: result.description });
      } catch (error) {
        if (turn === revision)
          update({
            phase: previousDescription ? 'ready' : 'captured',
            error: error instanceof Error ? error.message : String(error),
          });
      }
    },
    async append() {
      if (
        state.phase !== 'ready' ||
        !state.documentPath ||
        !state.description.trim() ||
        !state.title.trim()
      )
        return;
      cancel();
      const turn = revision;
      controller = new AbortController();
      update({ phase: 'saving', error: undefined });
      try {
        await request(
          '/api/component-documentation/append',
          {
            projectId: state.projectId,
            documentPath: state.documentPath,
            capture: state.capture,
            title: state.title,
            description: state.description,
          },
          controller.signal,
        );
        if (turn === revision) update({ phase: 'saved' });
      } catch (error) {
        if (turn === revision)
          update({ phase: 'ready', error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
