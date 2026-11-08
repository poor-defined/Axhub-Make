import React from 'react';
import { COMMENT_LIST_DOCK_MESSAGE, type CommentListDockAction, type CommentListDockState } from './comment-list-dock-protocol';

export function useCommentListHost(options: {
  enabled: boolean;
  origin?: string;
  snapshot: () => Omit<CommentListDockState, 'session'>;
  onAction: (action: CommentListDockAction) => void | Promise<void>;
}): boolean {
  const [hosted, setHosted] = React.useState(false);
  const latest = React.useRef(options); latest.current = options;
  React.useEffect(() => {
    setHosted(false);
    const origin = options.origin;
    if (!options.enabled || !origin || window.parent === window) return;
    const newSession = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    let session = newSession();
    let ackAt = 0; let scope = ''; let disposed = false;
    let generation = '';
    const running = new Set<string>();
    const post = (body: object) => window.parent.postMessage({ type: COMMENT_LIST_DOCK_MESSAGE, session, generation, ...body }, origin);
    const sync = () => {
      const snapshot = latest.current.snapshot();
      if (scope !== snapshot.scope) { if (scope) session = newSession(); scope = snapshot.scope; ackAt = 0; setHosted(false); }
      post({ kind: 'state', state: { ...snapshot, session } });
      if (Date.now() - ackAt > 2000) setHosted(false);
    };
    const listener = async (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || event.origin !== origin || data?.type !== COMMENT_LIST_DOCK_MESSAGE) return;
      if (data.kind === 'probe' && typeof data.generation === 'string') { generation = data.generation; sync(); return; }
      if (data.generation !== generation || data.session !== session || data.scope !== latest.current.snapshot().scope) return;
      if (data.kind === 'ack') { ackAt = Date.now(); setHosted(data.accepted === true); return; }
      if (data.kind !== 'action' || typeof data.id !== 'string' || running.has(data.id)) return;
      running.add(data.id);
      try {
        await latest.current.onAction(data.command);
        if (!disposed) { sync(); post({ kind: 'result', id: data.id, scope: data.scope }); }
      } catch (error) {
        if (!disposed) { sync(); post({ kind: 'result', id: data.id, scope: data.scope, error: error instanceof Error ? error.message : '批注操作失败' }); }
      } finally { running.delete(data.id); }
    };
    window.addEventListener('message', listener); sync();
    const timer = globalThis.setInterval(sync, 500);
    return () => {
      disposed = true; globalThis.clearInterval(timer); window.removeEventListener('message', listener);
      post({ kind: 'state', state: { ...latest.current.snapshot(), session, open: false } });
    };
  }, [options.enabled, options.origin]);
  return hosted && options.enabled;
}
