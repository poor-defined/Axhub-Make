import React from 'react';
import { CommentListView, COMMENT_LIST_DOCK_MESSAGE, isCommentListDockState, createEditorChromeCssVars, type CommentListDockAction, type CommentListDockState } from '@axhub/commentary';
import { PageSkeleton } from '@/components/ui/page-skeleton';

export function acceptsCommentDockMessage(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  if (!frame?.isConnected || !frame.contentWindow || event.source !== frame.contentWindow || event.data?.type !== COMMENT_LIST_DOCK_MESSAGE) return false;
  try { return event.origin !== 'null' && event.origin === new URL(frame.src).origin; } catch { return false; }
}

/** A workspace-owned dock; the preview keeps its iframe, logical size and drafts. */
export function useHostedCommentList(frameRef: React.RefObject<HTMLIFrameElement | null>, resourceKey: string, active: boolean) {
  const [snapshot, setSnapshot] = React.useState<CommentListDockState | null>(null);
  const latest = React.useRef(snapshot); latest.current = snapshot;
  const generationRef = React.useRef('');
  const retired = React.useRef(new Set<string>());
  const entries = React.useRef<React.ComponentProps<typeof CommentListView>['getEntries']>(() => []);
  entries.current = () => (latest.current?.entries ?? []).map(entry => ({ ...entry, element: null }));
  const getter = React.useCallback(() => entries.current(), []);
  const getLoadState = React.useCallback(() => latest.current?.loadState ?? { status: 'loading' as const }, []);
  const pending = React.useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const rejectPending = React.useCallback(() => {
    for (const task of pending.current.values()) { clearTimeout(task.timer); task.reject(new Error('预览已切换，请重新选择批注')); }
    pending.current.clear();
  }, []);
  React.useEffect(() => {
    if (latest.current) retired.current.add(JSON.stringify([latest.current.session, latest.current.scope]));
    setSnapshot(null); latest.current = null; rejectPending();
    if (!active) return;
    const generation = crypto.randomUUID(); generationRef.current = generation;
    let seenAt = 0;
    const probe = () => {
      const frame = frameRef.current;
      if (frame?.isConnected && frame.src) frame.contentWindow?.postMessage({ type: COMMENT_LIST_DOCK_MESSAGE, kind: 'probe', generation }, new URL(frame.src).origin);
    };
    const listener = (event: MessageEvent) => {
      if (!acceptsCommentDockMessage(event, frameRef.current)) return;
      const data = event.data;
      if (data.generation !== generation) return;
      if (data.kind === 'state' && isCommentListDockState(data.state)) {
        const state = data.state;
        if (retired.current.has(JSON.stringify([state.session, state.scope]))) return;
        if (latest.current && (latest.current.session !== state.session || latest.current.scope !== state.scope)) {
          retired.current.add(JSON.stringify([latest.current.session, latest.current.scope])); rejectPending();
        }
        if (!state.open) rejectPending();
        // A narrow workspace retains the iframe's stacked presentation.
        const accepted = window.innerWidth > 760;
        seenAt = Date.now(); latest.current = { ...state, open: state.open && accepted }; setSnapshot(latest.current);
        event.source?.postMessage({ type: COMMENT_LIST_DOCK_MESSAGE, kind: 'ack', generation, session: state.session, scope: state.scope, accepted }, { targetOrigin: event.origin });
      } else if (data.kind === 'result' && data.session === latest.current?.session && data.scope === latest.current?.scope) {
        const task = pending.current.get(data.id); if (!task) return;
        clearTimeout(task.timer); pending.current.delete(data.id);
        if (data.error) task.reject(new Error(String(data.error))); else task.resolve();
      }
    };
    const timer = setInterval(() => {
      probe();
      if (latest.current?.open && (!frameRef.current?.isConnected || Date.now() - seenAt > 2500)) {
        latest.current = null; setSnapshot(null); rejectPending();
      }
    }, 500);
    window.addEventListener('message', listener);
    probe();
    return () => { clearInterval(timer); window.removeEventListener('message', listener); rejectPending(); };
  }, [resourceKey, active, frameRef, rejectPending]);

  const request = React.useCallback((command: CommentListDockAction): Promise<void> => {
    const state = latest.current, frame = frameRef.current;
    if (!state?.open || !frame?.isConnected || !frame.contentWindow) return Promise.reject(new Error('批注面板已关闭，请重新打开'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(id); reject(new Error('操作等待超时，请重试')); }, 120000);
      pending.current.set(id, { resolve, reject, timer });
      frame.contentWindow!.postMessage({ type: COMMENT_LIST_DOCK_MESSAGE, kind: 'action', generation: generationRef.current, session: state.session, scope: state.scope, id, command }, new URL(frame.src).origin);
    });
  }, [frameRef]);
  const fire = (command: CommentListDockAction) => { void request(command).catch(() => {}); };
  return {
    open: Boolean(snapshot?.open),
    panel: snapshot ? <div data-hosted-comment-list="true" hidden={!snapshot.open} className="absolute inset-y-0 right-0 z-20 w-[320px] bg-background" style={{ ...createEditorChromeCssVars(snapshot.darkMode ? 'dark' : 'light'), position: 'absolute', top: 0, bottom: 0, right: 0, width: 320, zIndex: 20 }}>
      <CommentListView key={`${snapshot.session}:${snapshot.scope}`} hosted pinned hidden={!snapshot.open}
        getEntries={getter} getLoadState={getLoadState} selectedIds={snapshot.selectedIds} onSelectionChange={ids => fire({ action: 'select', ids })}
        onRun={(batchAction, ids) => request({ action: 'run', batchAction, ids: [...ids] })}
        onEdit={id => request({ action: 'edit', ids: [id] })} onLocateEntry={id => request({ action: 'locate', ids: [id] })}
        onRemove={id => request({ action: 'remove', ids: [id] })} onRemoveMany={ids => request({ action: 'remove', ids: [...ids] })}
        onRetry={() => request({ action: 'retry' })} loadingContent={<PageSkeleton variant="list" label="正在加载批注" />}
        onClose={() => fire({ action: 'close' })} onPinnedChange={() => fire({ action: 'unpin' })} onInteractionChange={() => {}}
        sendAvailable={snapshot.sendAvailable} generateAvailable={snapshot.generateAvailable} documentAvailable={snapshot.documentAvailable} />
    </div> : null,
  };
}
