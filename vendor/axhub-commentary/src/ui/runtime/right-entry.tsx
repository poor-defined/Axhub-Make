import React from 'react';
import { createPortal } from 'react-dom';
import { connectAnnotationToolbar } from './annotation-toolbar-bridge';
import { EDITOR_CHROME } from './theme';
import { resolveCspNonce } from '../csp-nonce';

const styles = `
  .we-right-entry{display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:auto}
  .we-right-entry[data-standalone=true]{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:10020;padding:6px 4px;border:1px solid ${EDITOR_CHROME.borderStrong};border-right:0;border-radius:12px 0 0 12px;background:${EDITOR_CHROME.surface}}
  .we-right-entry button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;flex-shrink:0;border:0;border-radius:6px;background:transparent;color:${EDITOR_CHROME.textSecondary};cursor:pointer;touch-action:manipulation}
  .we-right-entry button:hover{background:${EDITOR_CHROME.hoverSubtle}}
  .we-right-entry button[aria-expanded=true]{background:${EDITOR_CHROME.accentSoft};color:${EDITOR_CHROME.accent}}
  .we-right-entry button:focus-visible{outline:2px solid ${EDITOR_CHROME.accent};outline-offset:1px}
  @media(max-width:760px){.we-right-entry button{min-width:36px;min-height:36px}}
  @media(prefers-reduced-motion:reduce){.we-right-entry,.we-right-entry button{transition:none}}
`;

interface RightEntryActionsProps {
  open: boolean;
  onToggle: () => void;
  onShortcuts: () => void;
  standalone?: boolean;
}

export function RightEntryActions(props: RightEntryActionsProps): React.ReactElement {
  return (
    <div className="we-right-entry" data-we-right-entry="true" data-standalone={props.standalone === true}
      data-we-selection-lock-root="true" data-axhub-annotation-direct-action="true"
      role="group" aria-label="批注与快捷键"
      onPointerDown={event => event.stopPropagation()}>
      <style nonce={resolveCspNonce()}>{styles}</style>
      <button type="button" aria-label="批注列表" title="批注列表" aria-expanded={props.open}
        data-we-comment-list-entry="true" onClick={props.onToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 5h12M8 12h12M8 19h12" /><circle cx="3" cy="5" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="19" r="1" /></svg>
      </button>
      <button type="button" aria-label="快捷键" title="快捷键" onClick={props.onShortcuts}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h1m3 0h1m3 0h1m3 0h.1M6 12h1m3 0h1m3 0h1m3 0h.1M7 15h10" /></svg>
      </button>
    </div>
  );
}

export function RightEntry(props: RightEntryActionsProps & { onNativeAction: () => void }): React.ReactElement {
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const bridgeRef = React.useRef<ReturnType<typeof connectAnnotationToolbar> | null>(null);
  const nativeActionRef = React.useRef(props.onNativeAction);
  nativeActionRef.current = props.onNativeAction;
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const bridge = connectAnnotationToolbar(document, setMount, () => nativeActionRef.current());
    bridgeRef.current = bridge;
    return () => { bridge.dispose(); bridgeRef.current = null; };
  }, []);
  React.useEffect(() => { if (props.open) bridgeRef.current?.closePanels(); }, [props.open, mount]);
  const content = <RightEntryActions {...props} standalone={!mount} onShortcuts={() => {
    bridgeRef.current?.closePanels();
    props.onNativeAction();
    props.onShortcuts();
  }} />;
  return mount ? createPortal(content, mount) : content;
}
