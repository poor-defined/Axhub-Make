import React from 'react';
import { resolveCspNonce } from '../csp-nonce';
import { EDITOR_CHROME } from './theme';
import { getPageZoomView, PAGE_LAYOUT_CHANGE_EVENT, panPageZoom, setPageZoomEnabled, setPageZoomView, type PageZoomView } from '../../utils/page-zoom-toggle';

interface Props {
  active: boolean;
  docked: boolean;
  hasTarget: boolean;
  releaseRef: React.MutableRefObject<() => void>;
  onInteractionChange: (active: boolean) => void;
  getScopeKey?: () => string;
  activationRevision?: number;
}
const percentages = [10, 25, 50, 75, 100, 125, 150, 200, 300];
const styles = `
  .we-canvas-controls{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:3px;padding:4px;border:1px solid ${EDITOR_CHROME.borderStrong};border-radius:9px;background:${EDITOR_CHROME.surface};color:${EDITOR_CHROME.textPrimary};box-shadow:${EDITOR_CHROME.shadow};pointer-events:auto;z-index:10021;font-size:12px;font-family:inherit;max-width:calc(100vw - 24px)}
  .we-canvas-controls[data-docked=true]{left:calc((100vw - 364px)/2)}
  .we-canvas-controls button,.we-canvas-controls select{height:30px;box-sizing:border-box;border:0;border-radius:5px;background:transparent;color:inherit;font-family:inherit;font-size:12px;cursor:pointer}
  .we-canvas-controls button{display:flex;align-items:center;justify-content:center;width:30px;padding:0;flex-shrink:0}
  .we-canvas-controls button:hover,.we-canvas-controls select:hover{background:${EDITOR_CHROME.hoverSubtle}}
  .we-canvas-controls button:disabled{opacity:.4;cursor:not-allowed}
  .we-canvas-controls button[aria-pressed=true]{color:${EDITOR_CHROME.accent};background:${EDITOR_CHROME.accentSoft}}
  .we-canvas-controls button:focus-visible,.we-canvas-controls select:focus-visible{outline:2px solid ${EDITOR_CHROME.accent};outline-offset:1px}
  .we-canvas-controls select{width:80px;padding:0 4px;font-variant-numeric:tabular-nums;background:${EDITOR_CHROME.surface}}
  .we-canvas-controls__divider{height:18px;width:1px;background:${EDITOR_CHROME.border};margin:0 3px}
  @media(max-width:760px){.we-canvas-controls,.we-canvas-controls[data-docked=true]{left:calc((100vw - 52px)/2);bottom:10px;max-width:calc(100vw - 60px)}.we-canvas-controls[data-has-target=true]{top:calc(48dvh + 10px);bottom:auto}.we-canvas-controls button{width:28px}.we-canvas-controls select{width:72px}}
`;
function isEditable(event: Event): boolean {
  return event.composedPath().some(node => typeof (node as Element)?.matches === 'function'
    && (node as Element).matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
}
function isEditorUi(event: Event): boolean {
  return event.composedPath().some(node => typeof (node as Element)?.hasAttribute === 'function'
    && (node as Element).hasAttribute('data-we-selection-lock-root'));
}

/** Transform only the host content; the editor and annotation hosts stay outside it. */
export function PreviewCanvasControls(props: Props): React.ReactElement | null {
  const [view, setView] = React.useState(getPageZoomView);
  const [panMode, setPanMode] = React.useState(false);
  const [spaceDown, setSpaceDown] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const panModeRef = React.useRef(panMode); panModeRef.current = panMode;
  const lastViewRef = React.useRef<PageZoomView | null>(null);
  const scopeRef = React.useRef(props.getScopeKey?.());
  const interactionRef = React.useRef(props.onInteractionChange); interactionRef.current = props.onInteractionChange;
  const zoom = React.useCallback((scale: number | 'fit') => { setPageZoomView(scale); setView(getPageZoomView()); }, []);
  React.useEffect(() => {
    if (!props.getScopeKey) return;
    const check = () => {
      const next = props.getScopeKey?.();
      if (scopeRef.current === next) return;
      scopeRef.current = next; lastViewRef.current = null; zoom('fit');
    };
    const timer = globalThis.setInterval(check, 500);
    window.addEventListener('popstate', check); window.addEventListener('hashchange', check);
    return () => { globalThis.clearInterval(timer); window.removeEventListener('popstate', check); window.removeEventListener('hashchange', check); };
  }, [props.getScopeKey, zoom]);

  React.useEffect(() => {
    if (!props.active) return;
    let frame = 0; let acquired = false; let released = false;
    const sync = () => setView(getPageZoomView());
    const release = () => {
      window.cancelAnimationFrame(frame);
      if (released) return;
      released = true;
      if (acquired) lastViewRef.current = getPageZoomView();
      setPageZoomEnabled(false, { owner: 'canvas-controls' });
    };
    props.releaseRef.current = release;
    // Native directory effects restore their own styles before this view acquires them.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (released) return;
        setPageZoomEnabled(true, { owner: 'canvas-controls' }); acquired = true;
        const previous = lastViewRef.current;
        if (previous) {
          setPageZoomView(previous.mode === 'fit' ? 'fit' : previous.scale);
          panPageZoom(previous.panX, previous.panY);
        }
        sync();
      });
    });
    window.addEventListener(PAGE_LAYOUT_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(PAGE_LAYOUT_CHANGE_EVENT, sync);
      release(); interactionRef.current(false);
      if (props.releaseRef.current === release) props.releaseRef.current = () => {};
    };
  }, [props.active, props.releaseRef, props.activationRevision]);

  React.useEffect(() => {
    if (!props.active) return;
    let space = false;
    let drag: { x: number; y: number; id: number } | null = null;
    let suppressClick: { id: number; x: number; y: number; until: number } | null = null;
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const keyDown = (event: KeyboardEvent) => {
      if (isEditable(event) || event.altKey) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && ['+', '=', '-', '0'].includes(event.key)) {
        stop(event);
        zoom(event.key === '0' ? 1 : Math.round((getPageZoomView().scale + (event.key === '-' ? -0.1 : 0.1)) * 100) / 100);
      } else if (event.shiftKey && event.code === 'Digit1') { stop(event); zoom('fit'); }
      else if (event.code === 'Space' && !command && !isEditorUi(event)) { stop(event); space = true; setSpaceDown(true); }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space' && space) { stop(event); space = false; setSpaceDown(false); } };
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isEditable(event) || isEditorUi(event)) return;
      stop(event);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      setPageZoomView(getPageZoomView().scale * Math.exp(-delta * 0.002), { x: event.clientX, y: event.clientY });
    };
    const pointerDown = (event: PointerEvent) => {
      suppressClick = null;
      if (isEditable(event) || isEditorUi(event) || !(event.button === 1 || (event.button === 0 && (space || panModeRef.current)))) return;
      stop(event); drag = { x: event.clientX, y: event.clientY, id: event.pointerId }; setDragging(true);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      stop(event); panPageZoom(event.clientX - drag.x, event.clientY - drag.y);
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const pointerEnd = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      stop(event);
      if (event.type !== 'pointercancel') suppressClick = { id: event.pointerId, x: event.clientX, y: event.clientY, until: Date.now() + 500 };
      drag = null; setDragging(false);
    };
    const click = (event: MouseEvent) => {
      const gesture = suppressClick; suppressClick = null;
      if (gesture && Date.now() <= gesture.until && event.detail > 0 && Math.abs(event.clientX - gesture.x) < 4 && Math.abs(event.clientY - gesture.y) < 4) stop(event);
    };
    const blur = () => { space = false; drag = null; suppressClick = null; setSpaceDown(false); setDragging(false); };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', pointerDown, true); window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerEnd, true); window.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('click', click, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerdown', pointerDown, true); window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerEnd, true); window.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('blur', blur); blur();
    };
  }, [props.active, zoom]);
  React.useEffect(() => {
    if (!props.active || !(panMode || spaceDown || dragging)) return;
    const style = document.documentElement.style;
    const previous = style.getPropertyValue('cursor'), priority = style.getPropertyPriority('cursor');
    style.setProperty('cursor', dragging ? 'grabbing' : 'grab', 'important');
    return () => { if (previous) style.setProperty('cursor', previous, priority); else style.removeProperty('cursor'); };
  }, [props.active, panMode, spaceDown, dragging]);

  if (!props.active) return null;
  const percent = Math.round(view.scale * 100);
  const options = percentages.includes(percent) ? percentages : [...percentages, percent].sort((a, b) => a - b);
  const icon = (children: React.ReactNode) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
  return <div className="we-canvas-controls" role="toolbar" aria-label="预览画布操作" data-we-selection-lock-root="true" data-docked={props.docked} data-has-target={props.hasTarget}
    onPointerEnter={() => props.onInteractionChange(true)} onPointerLeave={() => props.onInteractionChange(false)}
    onFocusCapture={() => props.onInteractionChange(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onInteractionChange(false); }}>
    <style nonce={resolveCspNonce()}>{styles}</style>
    <button type="button" aria-label="缩小画布" title="缩小（Ctrl/⌘ −）" disabled={view.scale <= 0.1} onClick={() => zoom(Math.round((view.scale - 0.1) * 100) / 100)}>{icon(<path d="M5 12h14" />)}</button>
    <select aria-label="画布缩放比例" value={String(percent)} title="画布缩放比例" onChange={event => zoom(Number(event.target.value) / 100)}>{options.map(value => <option key={value} value={value}>{value}%</option>)}</select>
    <button type="button" aria-label="放大画布" title="放大（Ctrl/⌘ +）" disabled={view.scale >= 3} onClick={() => zoom(Math.round((view.scale + 0.1) * 100) / 100)}>{icon(<path d="M5 12h14M12 5v14" />)}</button>
    <span className="we-canvas-controls__divider" />
    <button type="button" aria-label="适应画布宽度" aria-pressed={view.mode === 'fit'} title="适应宽度（Shift 1）" onClick={() => zoom('fit')}>{icon(<><path d="M4 5v14M20 5v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3" /></>)}</button>
    <button type="button" aria-label="重置画布视图" title="重置为 100% 并复位（Ctrl/⌘ 0）" onClick={() => zoom(1)}>{icon(<><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6" /></>)}</button>
    <button type="button" aria-label="拖动画布" aria-pressed={panMode} title="拖动画布（也可按住空格或鼠标中键拖动）" onClick={() => setPanMode(value => !value)}>{icon(<path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-4-1-6-4l-4-5a2 2 0 0 1 3-2l2 2" />)}</button>
  </div>;
}
