import React from 'react';
import { toast } from 'sonner';
import { validateComponentDocumentationCapture } from '../../../common/componentDocumentation';
import { createDocumentationSession } from './documentationSession';
import { referenceRequest } from './referencePagesClient';
export function useComponentDocumentation(projectId: string | null) {
  const [session] = React.useState(() =>
    createDocumentationSession((path, body, signal) =>
      referenceRequest(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    ),
  );
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [documents, setDocuments] = React.useState<Array<{ path: string; title: string }>>([]),
    [documentsError, setDocumentsError] = React.useState('');
  const open = React.useCallback(
    (capture: unknown) => {
      if (!projectId) return;
      try {
        session.open(projectId, validateComponentDocumentationCapture(capture));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '组件图文数据无效，请重新选择组件');
      }
    },
    [projectId, session],
  );
  React.useEffect(() => {
    session.close();
    return () => session.close();
  }, [projectId, session]);
  React.useEffect(() => {
    const listener = (event: Event) => open((event as CustomEvent<unknown>).detail);
    window.addEventListener('axhub:document-component', listener);
    return () => window.removeEventListener('axhub:document-component', listener);
  }, [open]);
  React.useEffect(() => {
    if (!state.capture || !projectId) return;
    const controller = new AbortController();
    setDocuments([]);
    setDocumentsError('');
    void referenceRequest<{ documents: Array<{ path: string; title: string }> }>(
      `/api/component-documentation/documents?projectId=${encodeURIComponent(projectId)}`,
      { signal: controller.signal },
    )
      .then((body) => {
        if (!controller.signal.aborted) setDocuments(body.documents);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDocumentsError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [projectId, state.capture]);
  return { session, state, documents, documentsError, open };
}
