import type { CommentaryHostToolbarAction } from '@axhub/commentary';

/** Reuse Make's authenticated host-action channel for HTML selection exports. */
export async function requestParentAxureExport(payload: unknown, origin: string): Promise<boolean> {
  return requestParentComponentAction('prepare-axure-export', payload, origin);
}

export async function requestParentComponentAction(type: 'prepare-axure-export' | 'document-component', payload: unknown, origin: string): Promise<boolean> {
  return requestParentHostToolbarAction({ type, payload } as CommentaryHostToolbarAction, origin);
}

export async function requestParentHostToolbarAction(action: CommentaryHostToolbarAction, origin: string): Promise<boolean> {
  if (typeof window === 'undefined' || window.parent === window || !origin) return false;
  const requestId = `axure-export-${globalThis.crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const finish = (handled: boolean) => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(handled);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin
        || event.data?.type !== 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_RESULT'
        || event.data.requestId !== requestId) return;
      finish(event.data.handled === true);
    };
    const timer = window.setTimeout(() => finish(false), 15_000);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({
      type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST', requestId,
      action,
    }, origin);
  });
}
