import React from 'react';
import { referenceRequest, type ReferencePage, type LocalReferenceStatus } from './referencePagesClient';
export function useReferenceWorkspace(projectId: string | null) {
  const [active, setActive] = React.useState(false),
    [pages, setPages] = React.useState<ReferencePage[]>([]),
    [selected, setSelected] = React.useState<ReferencePage | null>(null),
    [localSource, setLocalSource] = React.useState<LocalReferenceStatus>({}),
    [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState(''),
    [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    setSelected(null);
    setPages([]);
    setLocalSource({});
    setActive(false);
  }, [projectId]);
  React.useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async (initial = false) => {
      if (inFlight) return;
      inFlight = true;
      if (initial) setLoading(true);
      try {
        const body = await referenceRequest<{ pages: ReferencePage[]; localSource?: LocalReferenceStatus }>(
          `/api/reference-pages?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setError('');
        setPages(body.pages);
        setLocalSource(body.localSource || {});
        setSelected(previous => body.pages.find(page => page.id === previous?.id) || body.pages[0] || null);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load(true);
    const timer = active ? setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void load();
    }, 5000) : undefined;
    return () => { controller.abort(); clearInterval(timer); };
  }, [projectId, version, active]);
  const imported = React.useCallback((page: ReferencePage) => {
    setPages(previous => [page, ...previous.filter(item => item.id !== page.id)]);
    setSelected(page);
  }, []);
  const deleted = React.useCallback((id: string) => {
    setPages(previous => previous.filter(page => page.id !== id));
    setSelected(previous => previous?.id === id ? pages.find(page => page.id !== id) || null : previous);
  }, [pages]);
  const refresh = React.useCallback(() => setVersion(value => value + 1), []);
  return { active, setActive, pages, selected, setSelected, localSource, loading, error, imported, deleted, refresh };
}
