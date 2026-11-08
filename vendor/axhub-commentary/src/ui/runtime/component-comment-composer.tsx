import React from 'react';
import { ArrowUpOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons';
import { COMMENT_PURPOSES, type ComponentCommentApi, type ComponentCommentPurpose, type ComponentCommentDraft } from '../../core/editor/component-comments';
import type { CommentListLoadState } from '../../core/editor/comment-batch';
import { mergePromptCardSkills, findPromptCardSkillTrigger, type PromptCardSkillOption } from './prompt-card-skills';
import { mergePromptImageAttachments, readPromptImageAttachmentsFromDataTransferItems } from './image-attachments';
import { EDITOR_CHROME } from './theme';
import { resolveCspNonce } from '../csp-nonce';

interface Props {
  api: ComponentCommentApi;
  element: Element;
  label: string;
  onClose: () => void;
  onSaved?: () => void;
  onExport?: () => void | Promise<void>;
  exportDisabled?: boolean;
  exportTitle?: string;
  tools?: React.ReactNode;
  available: Record<ComponentCommentPurpose, boolean>;
  skillOptions?: readonly PromptCardSkillOption[];
  enabledSkillIds?: readonly string[];
  editRequest?: { id: string; purpose: ComponentCommentPurpose; revision: number };
  getLoadState?: () => CommentListLoadState;
  loadingContent?: React.ReactNode;
  onRetry?: () => Promise<void>;
}

export function ComponentCommentComposer(props: Props): React.ReactElement {
  const [purpose, setPurpose] = React.useState<ComponentCommentPurpose>('modify-prototype');
  const scope = props.api.getScopeKey();
  const [draft, setDraft] = React.useState(() => props.api.getDraft(props.element, purpose));
  const [busy, setBusy] = React.useState<'save' | 'send' | 'export' | null>(null);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [loadState, setLoadState] = React.useState(() => props.getLoadState?.() ?? { status: 'ready' as const });
  const busyRef = React.useRef(false);
  const mounted = React.useRef(true);
  const context = React.useRef({ element: props.element, purpose, scope });
  context.current = { element: props.element, purpose, scope };
  const tabId = React.useId();
  const item = COMMENT_PURPOSES.find(item => item.id === purpose)!;
  const skills = mergePromptCardSkills(props.skillOptions ?? []).filter(skill => !props.enabledSkillIds || props.enabledSkillIds.includes(skill.id));
  const trigger = findPromptCardSkillTrigger(draft.note);
  React.useEffect(() => {
    setDraft(props.api.getDraft(props.element, purpose)); setError(''); setMessage('');
  }, [props.api, props.element, purpose, scope, props.editRequest?.revision]);
  React.useEffect(() => { if (props.editRequest) setPurpose(props.editRequest.purpose); }, [props.editRequest]);
  React.useEffect(() => {
    mounted.current = true;
    const timer = globalThis.setInterval(() => {
      const state = props.getLoadState?.() ?? { status: 'ready' as const };
      setLoadState(previous => previous.status === state.status && previous.revision === state.revision && previous.error === state.error ? previous : state);
    }, 300);
    return () => { mounted.current = false; globalThis.clearInterval(timer); };
  }, [props.getLoadState]);
  const update = (patch: Partial<Pick<ComponentCommentDraft, 'note' | 'images' | 'skillIds'>>) => {
    props.api.updateDraft(props.element, purpose, patch);
    setDraft(props.api.getDraft(props.element, purpose)); setError(''); setMessage('');
  };
  const perform = async (action: 'save' | 'send' | 'export') => {
    if (busyRef.current) return;
    if (action !== 'export' && (loadState.status !== 'ready' || !props.available[purpose] || (action === 'send' && !draft.note.trim()))) return;
    const origin = context.current;
    const stillCurrent = () => mounted.current && context.current.element === origin.element && context.current.purpose === origin.purpose && props.api.getScopeKey() === origin.scope;
    busyRef.current = true; setBusy(action); setError(''); setMessage('');
    let savedId: string | undefined;
    try {
      if (action === 'export') { await props.onExport?.(); return; }
      const entry = await props.api.saveDraft(origin.element, origin.purpose);
      savedId = entry.id;
      if (stillCurrent()) setDraft(props.api.getDraft(origin.element, origin.purpose));
      props.onSaved?.();
      if (action === 'send') {
        if (props.api.getScopeKey() !== origin.scope) throw new Error('页面已切换，批注已暂存，请在原页面发送');
        await props.api.run(item.action, [entry.id]);
      }
      if (stillCurrent()) setMessage(action === 'save' ? '已暂存，可继续添加批注' : purpose === 'modify-prototype' ? '已发送修改' : purpose === 'generate-prototype' ? '已打开新原型确认窗口' : '已打开引入说明窗口');
    } catch (cause) {
      if (stillCurrent()) {
        if (savedId && !props.api.getDraft(origin.element, origin.purpose).note) {
          try { props.api.edit(savedId); setDraft(props.api.getDraft(origin.element, origin.purpose)); } catch { /* The list retains records that have already started running. */ }
        }
        setError(cause instanceof Error ? cause.message : '操作失败，请重试');
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  };
  const disabled = busy !== null || loadState.status !== 'ready' || !props.available[purpose] || !props.element.isConnected;
  const sendDisabled = disabled || !draft.note.trim();
  return <section className="we-purpose-composer" aria-label="组件批注" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); props.onClose(); }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); if (!sendDisabled) void perform('send');
    }
  }}>
    <style nonce={resolveCspNonce()}>{`
      .we-purpose-composer{font-family:inherit;color:${EDITOR_CHROME.textPrimary};min-width:0;width:100%;display:flex;flex-direction:column;max-height:inherit;min-height:0}
      .we-purpose-composer *{box-sizing:border-box}
      .we-purpose-composer button,.we-purpose-composer select{font-family:inherit;cursor:pointer;color:inherit}
      .we-purpose-composer button:disabled{cursor:not-allowed;opacity:.5}
      .we-purpose-composer button:focus-visible,.we-purpose-composer textarea:focus-visible,.we-purpose-composer select:focus-visible{outline:2px solid ${EDITOR_CHROME.accent};outline-offset:2px}
      .we-purpose-composer__header{display:flex;flex-shrink:0;align-items:center;gap:6px;padding:12px;border-bottom:1px solid ${EDITOR_CHROME.border}}
      .we-purpose-composer__title{flex:1;min-width:0}.we-purpose-composer__title small{display:block;font-size:10px;color:${EDITOR_CHROME.textMuted};margin-bottom:3px}.we-purpose-composer__title strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .we-purpose-composer__icon{border:0;background:transparent;border-radius:6px;min-width:28px;min-height:28px;font-size:18px}
      .we-purpose-composer__tabs{display:grid;flex-shrink:0;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;margin:12px 12px 0;padding:3px;background:${EDITOR_CHROME.surfaceMuted};border:1px solid ${EDITOR_CHROME.border};border-radius:9px}
      .we-purpose-composer__tab{padding:8px 2px;white-space:nowrap;border:0;border-radius:6px;background:transparent;color:${EDITOR_CHROME.textSecondary}!important;font-size:12px}
      .we-purpose-composer__tab[aria-selected=true]{background:${EDITOR_CHROME.surface};color:${EDITOR_CHROME.accent}!important;box-shadow:0 1px 3px #00000012;font-weight:600}
      .we-purpose-composer__body{padding:12px;max-height:48dvh;min-height:0;flex:1;overflow:auto}
      .we-purpose-composer__input{display:block;resize:vertical;width:100%;min-height:100px;max-height:220px;border:1px solid ${EDITOR_CHROME.borderStrong};border-radius:10px;background:${EDITOR_CHROME.surfaceMuted};color:${EDITOR_CHROME.textPrimary};font:inherit;font-size:13px;line-height:1.7;padding:10px 12px}
      .we-purpose-composer__input::placeholder{color:${EDITOR_CHROME.textMuted}}
      .we-purpose-composer__hint{font-size:11px;line-height:1.6;color:${EDITOR_CHROME.textMuted};margin:8px 0 0}
      .we-purpose-composer__skills{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .we-purpose-composer__skills button,.we-purpose-composer select{font-size:11px;border:1px solid ${EDITOR_CHROME.border};border-radius:6px;padding:4px 6px;background:${EDITOR_CHROME.surface}}
      .we-purpose-composer__footer{display:flex;flex-shrink:0;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid ${EDITOR_CHROME.border};padding:10px 12px 12px}
      .we-purpose-composer__action{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px;padding:7px 10px;font-size:12px;white-space:nowrap;border:1px solid ${EDITOR_CHROME.borderStrong};border-radius:8px;background:${EDITOR_CHROME.surface}}
      .we-purpose-composer__send{background:${EDITOR_CHROME.accent};border-color:transparent;color:white!important}
      @media(max-width:380px){.we-purpose-composer__header{padding:10px}.we-purpose-composer__tab{font-size:11px}.we-purpose-composer__action{padding:7px 8px}}
      @media(prefers-reduced-motion:reduce){.we-purpose-composer *{animation:none!important;transition:none!important}}
    `}</style>
    <header className="we-purpose-composer__header"><div className="we-purpose-composer__title"><small>组件批注{draft.editingCommentId ? ' · 编辑中' : ''}</small><strong title={props.label}>{props.label}</strong></div>
      {props.tools}<button type="button" className="we-purpose-composer__icon" aria-label="关闭组件批注" title="关闭，保留草稿" onClick={props.onClose}>×</button>
    </header>
    <div role="tablist" aria-label="批注用途" className="we-purpose-composer__tabs">{COMMENT_PURPOSES.map((tab, index) => <button key={tab.id} type="button" role="tab"
      aria-label={tab.label} id={`${tabId}-${tab.id}`} aria-controls={`${tabId}-panel`} aria-selected={purpose === tab.id} tabIndex={purpose === tab.id ? 0 : -1}
      className="we-purpose-composer__tab" onClick={() => setPurpose(tab.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
        if (next !== null) { event.preventDefault(); setPurpose(COMMENT_PURPOSES[next].id); (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus(); }
      }}>{tab.label}</button>)}</div>
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${purpose}`} className="we-purpose-composer__body">
      {loadState.status === 'loading' ? props.loadingContent : loadState.status === 'error' ? <div><p role="alert">{loadState.error || '批注加载失败'}</p><button type="button" onClick={() => {
        setLoadState({ status: 'loading' }); void props.onRetry?.().catch(cause => setLoadState({ status: 'error', error: String(cause) }));
      }}>重新加载</button></div> : <>
        <textarea className="we-purpose-composer__input" aria-label="给 AI 的指示" rows={4} value={draft.note} maxLength={8000}
          placeholder={purpose === 'generate-prototype' ? '描述需要生成的组件状态，例如默认、加载中、错误…' : purpose === 'document-component' ? '描述要写入 PRD 的组件说明与交互规则…' : '输入对当前组件的修改要求，/ 选择技能'}
          onChange={event => update({ note: event.target.value })} onPaste={event => {
            if (!Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) return;
            event.preventDefault(); const origin = context.current;
            void readPromptImageAttachmentsFromDataTransferItems(event.clipboardData.items).then(incoming => {
              if (!mounted.current || props.api.getScopeKey() !== origin.scope) return;
              const previous = props.api.getDraft(origin.element, origin.purpose);
              const merged = mergePromptImageAttachments(previous.images, incoming);
              props.api.updateDraft(origin.element, origin.purpose, { images: merged.images });
              if (context.current.element === origin.element && context.current.purpose === origin.purpose) setDraft(props.api.getDraft(origin.element, origin.purpose));
              if (merged.droppedCount) setError('最多添加 3 张图片');
            }).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : '图片读取失败'); });
          }} />
        <div className="we-purpose-composer__skills">{draft.skillIds.map(id => <button key={id} type="button" aria-label={`移除技能 ${id}`} onClick={() => update({ skillIds: draft.skillIds.filter(value => value !== id) })}>{skills.find(skill => skill.id === id)?.label || id} ×</button>)}
          <select aria-label="添加技能" value="" onChange={event => {
            if (!event.target.value) return;
            update({ skillIds: Array.from(new Set([...draft.skillIds, event.target.value])), ...(trigger ? { note: draft.note.slice(0, trigger.start) + draft.note.slice(trigger.end) } : {}) });
          }}><option value="">＋ 技能</option>{skills.filter(skill => !draft.skillIds.includes(skill.id) && (!trigger?.query || `${skill.label} ${skill.description}`.includes(trigger.query))).map(skill => <option key={skill.id} value={skill.id}>{skill.label}</option>)}</select>
        </div>
        {draft.images.length ? <div className="we-purpose-composer__skills">{draft.images.map(image => <button key={image.id} type="button" aria-label={`移除附件 ${image.name}`} onClick={() => update({ images: draft.images.filter(item => item.id !== image.id) })}>
          <img src={image.data || image.assetPath} alt={image.name} width={24} height={24} style={{ objectFit: 'cover', verticalAlign: 'middle', borderRadius: 4 }} /> ×</button>)}</div> : null}
        <p className="we-purpose-composer__hint">{props.available[purpose] ? item.hint : '当前页面暂不支持此用途，请切换其他标签。'}</p>
        {draft.editingCommentId ? <button type="button" aria-label="新增批注" className="we-purpose-composer__action" onClick={() => { props.api.startNew(props.element, purpose); setDraft(props.api.getDraft(props.element, purpose)); }}>新增批注</button> : null}
      </>}
      {error ? <p role="alert" style={{ color: EDITOR_CHROME.textDanger, fontSize: 12, margin: '8px 0 0' }}>{error}</p> : null}
      {message ? <p role="status" className="we-purpose-composer__hint">{message}</p> : null}
    </div>
    <footer className="we-purpose-composer__footer">
      {props.onExport ? <button type="button" className="we-purpose-composer__action" aria-label="导出组件" title={props.exportTitle || '导出选中组件'} disabled={Boolean(busy) || props.exportDisabled} aria-busy={busy === 'export'} onClick={() => perform('export')}>
        {busy === 'export' ? <LoadingOutlined spin /> : <ExportOutlined />}导出</button> : null}
      <span style={{ flex: 1 }} />
      <button type="button" className="we-purpose-composer__action" aria-label="暂存批注" disabled={disabled} aria-busy={busy === 'save'} onClick={() => perform('save')}>{busy === 'save' ? '暂存中…' : '暂存批注'}</button>
      <button type="button" className="we-purpose-composer__action we-purpose-composer__send" aria-label="发送" title={`发送：${item.label}（⌘/Ctrl Enter）`} disabled={sendDisabled} aria-busy={busy === 'send'} onClick={() => perform('send')}>
        {busy === 'send' ? <LoadingOutlined spin /> : <ArrowUpOutlined />}{busy === 'send' ? '处理中…' : '发送'}</button>
    </footer>
  </section>;
}
