import React from 'react';
import type { CommentBatchAction, CommentListEntry, CommentListLoadState } from '../../core/editor/comment-batch';
import { resolveCspNonce } from '../csp-nonce';
import { EDITOR_CHROME } from './theme';
import { COMMENT_PURPOSES, isComponentCommentPurpose } from '../../core/editor/component-comments';

interface CommentListViewProps {
  getEntries: () => CommentListEntry[];
  onRun: (action: CommentBatchAction, ids: readonly string[]) => Promise<void>;
  onLocate?: (element: Element) => void;
  onLocateEntry?: (id: string) => void | Promise<void>;
  hosted?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onEdit?: (id: string) => void | Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onRemoveMany?: (ids: readonly string[]) => Promise<void>;
  pinned?: boolean;
  hidden?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  onClose: () => void;
  onInteractionChange: (active: boolean) => void;
  sendAvailable: boolean;
  generateAvailable: boolean;
  documentAvailable: boolean;
  hasTarget?: boolean;
  getLoadState?: () => CommentListLoadState;
  onRetry?: () => Promise<void>;
  loadingContent?: React.ReactNode;
}
const actions = [
  { action: 'send', label: '发送修改', available: 'sendAvailable' },
  { action: 'generate', label: '生成原型', available: 'generateAvailable' },
  { action: 'document', label: '引入说明', available: 'documentAvailable' },
] as const;
const styles = `
  .we-comment-list{position:fixed;right:52px;top:16px;bottom:16px;width:320px;max-width:calc(100vw - 64px);display:flex;flex-direction:column;pointer-events:auto;border:1px solid ${EDITOR_CHROME.border};border-radius:14px;background:${EDITOR_CHROME.surface};color:${EDITOR_CHROME.textPrimary};box-shadow:${EDITOR_CHROME.shadow};overflow:hidden;z-index:10020;font-size:12px;font-family:inherit}
  .we-comment-list *{box-sizing:border-box}
  .we-comment-list[hidden]{display:none}
  .we-comment-list[data-hosted=true]{position:absolute;inset:0;width:100%;max-width:100%;border-radius:0;box-shadow:none}
  @media(min-width:761px){.we-comment-list[data-pinned=true]{right:0;top:0;bottom:0;border-radius:0;box-shadow:none}}
  .we-comment-list button{font-family:inherit;font-size:12px;cursor:pointer;color:inherit}
  .we-comment-list button:disabled{cursor:not-allowed;opacity:.45}
  .we-comment-list button:focus-visible,.we-comment-list input:focus-visible{outline:2px solid ${EDITOR_CHROME.accent};outline-offset:2px}
  .we-comment-list__header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px;border-bottom:1px solid ${EDITOR_CHROME.border}}
  .we-comment-list__header h2{margin:0;font-size:14px;font-weight:600}
  .we-comment-list__close{border:0;background:transparent;width:28px;height:28px;border-radius:6px;font-size:20px!important}
  .we-comment-list__selection{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;color:${EDITOR_CHROME.textSecondary}}
  .we-comment-list label{display:flex;align-items:center;gap:8px;cursor:pointer}
  .we-comment-list input{margin:0;accent-color:${EDITOR_CHROME.accent};width:15px;height:15px;flex-shrink:0}
  .we-comment-list__body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 12px 12px}
  .we-comment-list__item{padding:12px;margin-bottom:8px;border:1px solid ${EDITOR_CHROME.border};border-radius:9px;background:${EDITOR_CHROME.surfaceMuted}}
  .we-comment-list__item[data-selected=true]{border-color:${EDITOR_CHROME.accent};background:${EDITOR_CHROME.accentSoft}}
  .we-comment-list__item header{display:flex;align-items:center;gap:8px}
  .we-comment-list__locate{padding:2px 0;border:0;background:transparent;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-weight:600}
  .we-comment-list__note{margin:8px 0 0 23px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;color:${EDITOR_CHROME.textSecondary}}
  .we-comment-list__hint{font-size:11px;line-height:1.6;color:${EDITOR_CHROME.textMuted};margin:8px 0 0}
  .we-comment-list__empty{padding:44px 16px;text-align:center;line-height:1.8;color:${EDITOR_CHROME.textMuted}}
  .we-comment-list__footer{padding:12px 16px;border-top:1px solid ${EDITOR_CHROME.border};flex-shrink:0}
  .we-comment-list__actions{display:flex;gap:6px;flex-wrap:wrap}
  .we-comment-list__action{flex:1;min-height:34px;white-space:nowrap;padding:6px 8px;border:1px solid ${EDITOR_CHROME.borderStrong};border-radius:7px;background:${EDITOR_CHROME.surface}}
  .we-comment-list__action:first-child{background:${EDITOR_CHROME.accent};color:white;border-color:transparent}
  .we-comment-list .ax-page-skeleton{--ax-sk-fill:${EDITOR_CHROME.surfaceInteractive};--ax-sk-shine:${EDITOR_CHROME.surfaceMuted}}
  @media(max-width:760px){.we-comment-list{right:52px;top:8px;bottom:8px;width:320px;max-width:calc(100vw - 60px)}.we-comment-list[data-has-target=true]{bottom:52dvh}.we-comment-list__header{padding:10px 12px}.we-comment-list__selection{padding:8px 12px}.we-comment-list__footer{padding:8px 12px}.we-comment-list__hint{margin-top:4px}}
`;

export function CommentListEntryButton(props: { onClick: () => void }): React.ReactElement {
  return (
    <button type="button" aria-label="打开批注列表" title="批注列表" data-we-comment-list-entry="true" data-we-selection-lock-root="true"
      onClick={props.onClick}
      style={{ position: 'fixed', right: 0, top: '50%', zIndex: 10020, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 40, border: `1px solid ${EDITOR_CHROME.borderStrong}`, borderRadius: '9px 0 0 9px', background: EDITOR_CHROME.surface, color: EDITOR_CHROME.textSecondary, cursor: 'pointer' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 5h12M8 12h12M8 19h12" /><circle cx="3" cy="5" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="19" r="1" /></svg>
    </button>
  );
}

export function CommentListView(props: CommentListViewProps): React.ReactElement {
  const [filter, setFilter] = React.useState('all');
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [confirmIds, setConfirmIds] = React.useState<string[]>([]);
  const deletingRef = React.useRef(false);
  const [entries, setEntries] = React.useState<CommentListEntry[]>(() => {
    try { return props.getEntries(); } catch { return []; }
  });
  const [selected, setSelectedState] = React.useState<string[]>(props.selectedIds ?? []);
  const selectedRef = React.useRef(selected); selectedRef.current = selected;
  const setSelected = (value: React.SetStateAction<string[]>) => {
    const next = typeof value === 'function' ? value(selectedRef.current) : value;
    if (next === selectedRef.current) return;
    selectedRef.current = next; setSelectedState(next); props.onSelectionChange?.(next);
  };
  const selectedKey = JSON.stringify(props.selectedIds);
  React.useEffect(() => { if (props.selectedIds) { selectedRef.current = props.selectedIds; setSelectedState(props.selectedIds); } }, [selectedKey]);
  const [loadState, setLoadState] = React.useState<CommentListLoadState>(() => props.getLoadState?.() ?? { status: 'ready' });
  const selectionRevisionRef = React.useRef(loadState.revision);
  const [busy, setBusy] = React.useState<CommentBatchAction | 'delete' | null>(null);
  const [error, setError] = React.useState('');
  const [readError, setReadError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const busyRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      try {
        const state = props.getLoadState?.() ?? { status: 'ready' as const };
        if (selectionRevisionRef.current !== state.revision) {
          selectionRevisionRef.current = state.revision;
          setSelected([]); setConfirmIds([]); setError(''); setMessage('');
        }
        setLoadState(previous => previous.status === state.status && previous.error === state.error && previous.revision === state.revision ? previous : state);
        // Persistence uses optimistic tombstones; keep the selection visible until success or rollback.
        if (deletingRef.current) return;
        const next = props.getEntries();
        setEntries(previous => previous.length === next.length && previous.every((entry, i) => {
          const item = next[i];
          return entry.id === item.id && entry.note === item.note && entry.label === item.label && entry.element === item.element && entry.disabledReason === item.disabledReason && entry.purpose === item.purpose && entry.state === item.state;
        }) ? previous : next);
        if (!props.hidden) setSelected(previous => previous.every(id => next.some(entry => entry.id === id)) ? previous : previous.filter(id => next.some(entry => entry.id === id)));
        setReadError('');
      } catch (cause) { setReadError(cause instanceof Error ? cause.message : '批注读取失败，请重试'); }
    };
    refresh();
    const timer = globalThis.setInterval(refresh, 500);
    return () => { mountedRef.current = false; globalThis.clearInterval(timer); };
  }, [props.getEntries, props.getLoadState, props.hidden]);
  React.useEffect(() => () => props.onInteractionChange(false), [props.onInteractionChange]);
  React.useEffect(() => { if (props.hidden) props.onInteractionChange(false); }, [props.hidden, props.onInteractionChange]);
  const purposeMode = Boolean(props.onEdit);
  const visibleEntries = entries.filter(entry => (!purposeMode || Boolean(entry.purpose)) && (filter === 'all' || entry.purpose === filter));
  const available = visibleEntries.filter(entry => (entry.element || entry.locatable) && !entry.disabledReason && (!purposeMode || isComponentCommentPurpose(entry.purpose)));
  const selectable = props.onRemoveMany ? visibleEntries.filter(entry => entry.state !== 'editing') : available;
  const selectedEntries = entries.filter(entry => selected.includes(entry.id));
  const selectedPurpose = selectedEntries[0]?.purpose;
  const selectedAction = COMMENT_PURPOSES.find(item => item.id === selectedPurpose);
  const mixedPurpose = selectedEntries.some(entry => entry.purpose !== selectedPurpose);
  const allSelected = selectable.length > 0 && selectable.every(entry => selected.includes(entry.id));
  const undeletableSelection = selected.some(id => !selectable.some(entry => entry.id === id));
  const unavailableSelection = selected.some(id => !available.some(entry => entry.id === id));
  const run = async (action: CommentBatchAction) => {
    const latest = props.getLoadState?.();
    if (latest && (latest.status !== 'ready' || latest.revision !== selectionRevisionRef.current)) {
      setSelected([]); setError('页面已切换或正在加载，请重新选择批注'); return;
    }
    if (busyRef.current || !selected.length || unavailableSelection || loadState.status !== 'ready') return;
    if (purposeMode && (mixedPurpose || !selectedAction || selectedAction.action !== action)) { setError('请选择同一用途的批注后发送'); return; }
    busyRef.current = true; setBusy(action); setError(''); setMessage('');
    try {
      await props.onRun(action, selected.slice());
      if (mountedRef.current) setMessage(action === 'send' ? '已提交所选批注的修改' : action === 'generate' ? '已打开原型生成窗口' : '已打开引入说明窗口');
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  };
  const removeIds = async (ids: readonly string[]) => {
    const latest = props.getLoadState?.();
    if (latest && (latest.status !== 'ready' || latest.revision !== selectionRevisionRef.current)) {
      setSelected([]); setConfirmIds([]); setError('页面已切换或正在加载，请重新选择批注'); return;
    }
    if (busyRef.current || !ids.length || loadState.status !== 'ready') return;
    const revision = selectionRevisionRef.current;
    const isCurrent = () => mountedRef.current && (props.getLoadState?.().revision ?? revision) === revision;
    busyRef.current = true; deletingRef.current = true; setBusy('delete'); setRemovingId(ids.length === 1 ? ids[0] : null); setError(''); setMessage('');
    try {
      if (props.onRemoveMany) await props.onRemoveMany(ids.slice());
      else if (props.onRemove && ids.length === 1) await props.onRemove(ids[0]);
      else throw new Error('暂不支持删除，请刷新后重试');
      if (isCurrent()) {
        setEntries(props.getEntries()); setSelected(previous => previous.filter(id => !ids.includes(id)));
        setConfirmIds([]); setMessage(`已删除 ${ids.length} 条批注`);
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '删除失败，请重试');
    } finally {
      busyRef.current = false; deletingRef.current = false;
      if (mountedRef.current) { setBusy(null); setRemovingId(null); }
    }
  };
  return (
    <aside className="we-comment-list" hidden={props.hidden} data-hosted={props.hosted === true} data-pinned={props.pinned === true} data-has-target={props.hasTarget === true} data-we-selection-lock-root="true" aria-label="批注列表"
      onPointerEnter={() => props.onInteractionChange(true)} onPointerLeave={() => props.onInteractionChange(false)}
      onFocusCapture={() => props.onInteractionChange(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onInteractionChange(false); }}>
      <style nonce={resolveCspNonce()}>{styles}</style>
      <header className="we-comment-list__header"><h2>批注列表 <span style={{ color: EDITOR_CHROME.textMuted, fontWeight: 400 }}>{entries.length}</span></h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {props.onPinnedChange ? <button type="button" className="we-comment-list__close" aria-label={props.pinned ? '取消固定批注列表' : '固定批注列表到右侧'} title={props.pinned ? '取消固定' : '固定到右侧'} aria-pressed={props.pinned === true} onClick={() => props.onPinnedChange?.(!props.pinned)} style={{ color: props.pinned ? EDITOR_CHROME.accent : undefined }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={props.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m16 3 5 5-4 2-3 6-2-2-7 7-1-1 7-7-2-2 6-3z" /></svg>
          </button> : null}
          <button className="we-comment-list__close" aria-label="关闭批注列表" title="关闭批注列表" onClick={props.onClose}>×</button>
        </div></header>
      {purposeMode ? <label style={{ padding: '10px 16px 0', fontSize: 11, color: EDITOR_CHROME.textSecondary }}>用途
        <select aria-label="筛选批注用途" disabled={Boolean(busy)} value={filter} onChange={event => { setFilter(event.target.value); setSelected([]); setConfirmIds([]); setError(''); setMessage(''); }}
          style={{ flex: 1, minWidth: 0, padding: 6, background: EDITOR_CHROME.surface, color: EDITOR_CHROME.textPrimary, border: `1px solid ${EDITOR_CHROME.border}`, borderRadius: 6 }}>
          <option value="all">全部批注</option>{COMMENT_PURPOSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label> : null}
      <div className="we-comment-list__selection">
        <label><input type="checkbox" aria-label="全选批注" checked={allSelected} disabled={loadState.status !== 'ready' || Boolean(busy) || (!selectable.length && !selected.length)}
          ref={node => { if (node) node.indeterminate = selected.length > 0 && !allSelected; }}
          onChange={() => { setSelected(allSelected ? [] : selectable.map(entry => entry.id)); setConfirmIds([]); }} />全选</label>
        <span aria-live="polite">已选 {selected.length} 条</span>
      </div>
      <div className="we-comment-list__body">
        {loadState.status === 'loading' ? props.loadingContent ?? (
          <div role="status" aria-label="正在加载批注" aria-busy="true">{[1, 2, 3, 4].map(i => <div key={i} aria-hidden="true" style={{ height: 72, marginBottom: 10, borderRadius: 9, background: EDITOR_CHROME.surfaceInteractive }} />)}</div>
        ) : loadState.status === 'error' || readError ? <div><p role="alert">{loadState.error || readError || '批注加载失败，请重试'}</p>
          {props.onRetry ? <button type="button" aria-label="重试加载批注" className="we-comment-list__action" onClick={async () => {
            setLoadState({ status: 'loading' }); setError('');
            try { await props.onRetry?.(); setLoadState(props.getLoadState?.() ?? { status: 'ready' }); }
            catch (cause) { setLoadState({ status: 'error', error: cause instanceof Error ? cause.message : '批注加载失败，请重试' }); }
          }}>重新加载</button> : null}</div> : !visibleEntries.length ? <div className="we-comment-list__empty">暂无批注<br />选择页面组件并暂存批注后，将显示在这里。</div> : visibleEntries.map((entry, index) => (
          <article key={entry.id} className="we-comment-list__item" data-selected={selected.includes(entry.id)}>
            <header><input type="checkbox" aria-label={`选择批注 ${entry.label}`} checked={selected.includes(entry.id)} disabled={Boolean(busy) || loadState.status !== 'ready' || (!selectable.some(item => item.id === entry.id) && !selected.includes(entry.id))}
              onChange={() => { setSelected(previous => previous.includes(entry.id) ? previous.filter(id => id !== entry.id) : [...previous, entry.id]); setConfirmIds([]); setError(''); setMessage(''); }} />
              <button className="we-comment-list__locate" title={`定位组件：${entry.label}`} disabled={(!entry.element && !entry.locatable) || Boolean(busy)} onClick={async () => {
                try { if (props.onLocateEntry) await props.onLocateEntry(entry.id); else if (entry.element) props.onLocate?.(entry.element); }
                catch (cause) { setError(cause instanceof Error ? cause.message : '无法定位组件'); }
              }}>{index + 1}. {entry.label}</button>
            </header>
            <p className="we-comment-list__note">{entry.note || (entry.purpose ? '未填写指示' : '已保存组件修改')}</p>
            {purposeMode ? <div style={{ margin: '8px 0 0 23px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: EDITOR_CHROME.accent, padding: '2px 5px', background: EDITOR_CHROME.accentSoft, borderRadius: 4 }}>{COMMENT_PURPOSES.find(item => item.id === entry.purpose)?.label || '暂不支持的用途'}</span>
              <span style={{ fontSize: 10, color: EDITOR_CHROME.textMuted }}>{entry.state === 'editing' ? '执行中' : entry.state === 'completed' ? '已完成' : entry.state === 'error' ? '执行失败' : '已暂存'}</span>
              {isComponentCommentPurpose(entry.purpose) ? <button type="button" aria-label={`编辑批注 ${entry.label}`} disabled={Boolean(busy) || Boolean(entry.disabledReason)} onClick={async () => {
                try { await props.onEdit?.(entry.id); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法编辑批注'); }
              }} style={{ border: 0, background: 'transparent', padding: 3, marginLeft: 'auto', color: EDITOR_CHROME.textSecondary }}>编辑</button> : null}
              {props.onRemove || props.onRemoveMany ? <button type="button" aria-label={`删除批注 ${entry.label}`} disabled={Boolean(busy) || loadState.status !== 'ready' || entry.state === 'editing'} onClick={() => removeIds([entry.id])} style={{ border: 0, background: 'transparent', padding: 3, color: EDITOR_CHROME.textMuted }}>{removingId === entry.id ? '删除中…' : '删除'}</button> : null}
            </div> : null}
            {entry.disabledReason ? <p className="we-comment-list__hint">{entry.disabledReason}</p> : null}
          </article>
        ))}
      </div>
      <footer className="we-comment-list__footer">
        <div className="we-comment-list__actions">{purposeMode ? <button type="button" className="we-comment-list__action" aria-label="发送所选批注" aria-busy={Boolean(busy)}
          disabled={loadState.status !== 'ready' || Boolean(busy) || !selected.length || unavailableSelection || mixedPurpose || !selectedAction || Boolean(readError) || !props[actions.find(item => item.action === selectedAction.action)?.available || 'sendAvailable']}
          onClick={() => { if (selectedAction) return run(selectedAction.action); }}>{busy ? '处理中…' : selectedAction && !mixedPurpose ? `发送 · ${selectedAction.label}` : '发送'}</button> : actions.map(item => (
          <button key={item.action} className="we-comment-list__action" aria-label={item.label} aria-busy={busy === item.action}
            disabled={loadState.status !== 'ready' || Boolean(busy) || !selected.length || unavailableSelection || !props[item.available] || Boolean(readError)}
            onClick={() => run(item.action)}>{busy === item.action ? '处理中…' : item.label}</button>
        ))}
          {props.onRemoveMany ? <button type="button" className="we-comment-list__action" aria-label="删除所选批注" disabled={!selected.length || Boolean(busy) || loadState.status !== 'ready' || undeletableSelection || Boolean(readError)} onClick={() => { setConfirmIds(selected.slice()); setError(''); }} style={{ color: EDITOR_CHROME.textDanger }}>删除{selected.length ? ` (${selected.length})` : ''}</button> : null}
        </div>
        {confirmIds.length ? <div role="alertdialog" aria-label="确认删除所选批注" aria-describedby="we-comment-delete-description" style={{ marginTop: 10 }}>
          <p id="we-comment-delete-description">删除这 {confirmIds.length} 条批注？删除后无法恢复。</p>
          <div className="we-comment-list__actions"><button type="button" className="we-comment-list__action" aria-label="确认删除批注" disabled={Boolean(busy)} onClick={() => removeIds(confirmIds)}>{busy === 'delete' ? '删除中…' : '确认删除'}</button>
            <button type="button" className="we-comment-list__action" aria-label="取消删除批注" disabled={Boolean(busy)} onClick={() => setConfirmIds([])}>取消</button></div>
        </div> : null}
        <p className="we-comment-list__hint">{purposeMode ? mixedPurpose ? '已选批注用途不同，请按用途分别发送。' : '选择同一用途的批注，可一次发送多条。' : '三个动作可分别执行，暂存批注供后续继续使用。'}</p>
        {error ? <p role="alert" style={{ color: EDITOR_CHROME.textDanger, marginBottom: 0 }}>{error}</p> : null}
        {message ? <p role="status" style={{ color: EDITOR_CHROME.accent, marginBottom: 0 }}>{message}</p> : null}
      </footer>
    </aside>
  );
}
