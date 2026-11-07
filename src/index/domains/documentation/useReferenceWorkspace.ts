import React from 'react';
import { referenceRequest, type ReferencePage } from './referencePagesClient';
export function useReferenceWorkspace(projectId: string | null) {
  const [active, setActive] = React.useState(false),
    [pages, setPages] = React.useState<ReferencePage[]>([]),
    [selected, setSelected] = React.useState<ReferencePage | null>(null),
    [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState(''),
    [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    setSelected(null);
    setPages([]);
    setActive(false);
  }, [projectId]);
  React.useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void referenceRequest<{ pages: ReferencePage[] }>(
      `/api/reference-pages?projectId=${encodeURIComponent(projectId)}`,
      { signal: controller.signal },
    )
      .then((body) => {
        if (controller.signal.aborted) return;
        setPages(body.pages);
        setSelected(
          (previous) =>
            body.pages.find((page) => page.id === previous?.id) || body.pages[0] || null,
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, version]);
  const imported = React.useCallback((page: ReferencePage) => {
    setPages((previous) => [page, ...previous.filter((item) => item.id !== page.id)]);
    setSelected(page);
  }, []);
  const refresh = React.useCallback(() => setVersion((value) => value + 1), []);
  return { active, setActive, pages, selected, setSelected, loading, error, imported, refresh };
}
