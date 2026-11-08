import { WEB_EDITOR_V2_HOST_ID } from '../constants';

export const PAGE_LAYOUT_CHANGE_EVENT = 'commentary:page-layout-change';

type InlineStyleSnapshot = {
  value: string;
  priority: string;
};

type PageZoomOptions = {
  reservedRightWidth?: number;
  owner?: string;
};

type PageZoomState = {
  enabled: boolean;
  reservedRightWidth: number;
  bodySnapshots: Map<string, InlineStyleSnapshot>;
  htmlSnapshots: Map<string, InlineStyleSnapshot>;
  editorHostMountSnapshot: { parent: Node; nextSibling: ChildNode | null } | null;
  resizeHandler: (() => void) | null;
};

const state: PageZoomState = {
  enabled: false,
  reservedRightWidth: 0,
  bodySnapshots: new Map(),
  htmlSnapshots: new Map(),
  editorHostMountSnapshot: null,
  resizeHandler: null,
};
const reservations = new Map<string, number>();
let manualScale: number | null = null;
let panX = 0;
let panY = 0;
let appliedScale = 1;
let appliedX = 0;
let contentLeft = 0;
let originX = 0;
let originY = 0;
let contentWidth = 0;
let baseTransform = '';
let nativeSuspension: { body: HTMLElement; href: string; bodyStyles: Map<string, InlineStyleSnapshot>; htmlStyles: Map<string, InlineStyleSnapshot> } | null = null;

/** The native package clears its snapshots twice on close. Keep our baseline
 * across that handoff, scoped to this body and page, without changing its panel. */
export function suspendPageZoomForNativePanel(): void {
  if (!state.enabled) return;
  nativeSuspension = { body: document.body, href: window.location?.href ?? '',
    bodyStyles: new Map(state.bodySnapshots), htmlStyles: new Map(state.htmlSnapshots) };
}

export interface PageZoomView {
  scale: number;
  mode: 'fit' | 'manual';
  panX: number;
  panY: number;
  reservedRightWidth: number;
}
export function getPageZoomView(): PageZoomView {
  return { scale: appliedScale, mode: manualScale === null ? 'fit' : 'manual', panX, panY, reservedRightWidth: state.reservedRightWidth };
}
const fitOffset = (scale: number) => -Math.max(0, contentLeft * scale - 16);
export function setPageZoomView(scale: number | 'fit', anchor?: { x: number; y: number }): void {
  if (!state.enabled) return;
  if (scale === 'fit') { manualScale = null; panX = 0; panY = 0; }
  else {
    const next = Number.isFinite(scale) ? Math.min(3, Math.max(0.1, scale)) : appliedScale;
    if (anchor) {
      const ratio = next / appliedScale;
      const x = anchor.x + (window.scrollX || 0) - originX;
      const y = anchor.y + (window.scrollY || 0) - originY;
      panX = x - (x - appliedX) * ratio - fitOffset(next);
      panY = y - (y - panY) * ratio;
    } else { panX = 0; panY = 0; }
    manualScale = next;
  }
  applyPageZoom(scale === 'fit');
}
export function panPageZoom(x: number, y: number): void {
  if (!state.enabled || !Number.isFinite(x) || !Number.isFinite(y)) return;
  panX += x; panY += y;
  applyPageZoom(false);
}

function readInlineStyle(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue' | 'getPropertyPriority'>,
  property: string,
): InlineStyleSnapshot {
  return {
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property),
  };
}

function restoreInlineStyle(
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>,
  property: string,
  snapshot: InlineStyleSnapshot | undefined,
): void {
  if (!snapshot) {
    style.removeProperty(property);
    return;
  }

  if (snapshot.value) {
    style.setProperty(property, snapshot.value, snapshot.priority);
    return;
  }

  style.removeProperty(property);
}

function captureSnapshots(): void {
  if (typeof document === 'undefined' || !document.body || !document.documentElement) {
    return;
  }

  if (state.bodySnapshots.size > 0 || state.htmlSnapshots.size > 0) {
    return;
  }

  const bodyStyle = document.body.style;
  const htmlStyle = document.documentElement.style;

  ['transform', 'transform-origin'].forEach((property) => {
    state.bodySnapshots.set(property, readInlineStyle(bodyStyle, property));
  });
  ['overflow-x'].forEach((property) => {
    state.htmlSnapshots.set(property, readInlineStyle(htmlStyle, property));
  });
}

function isBodyDescendant(element: HTMLElement): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (typeof document.body.contains === 'function') {
    return document.body.contains(element);
  }
  return element.parentElement === document.body;
}

function hoistEditorHostOutsideBodyTransform(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const editorHost = document.getElementById(WEB_EDITOR_V2_HOST_ID);
  if (!editorHost) return;
  if (editorHost.parentElement === document.documentElement) return;
  if (!isBodyDescendant(editorHost)) return;

  if (!state.editorHostMountSnapshot && editorHost.parentNode) {
    state.editorHostMountSnapshot = {
      parent: editorHost.parentNode,
      nextSibling: editorHost.nextSibling,
    };
  }
  document.documentElement.append(editorHost);
}

function restoreEditorHostMount(): void {
  if (typeof document === 'undefined') return;
  const snapshot = state.editorHostMountSnapshot;
  state.editorHostMountSnapshot = null;
  if (!snapshot) return;

  const editorHost = document.getElementById(WEB_EDITOR_V2_HOST_ID);
  if (!editorHost) return;
  if (!snapshot.parent.isConnected) return;

  if (snapshot.nextSibling && snapshot.nextSibling.parentNode === snapshot.parent) {
    snapshot.parent.insertBefore(editorHost, snapshot.nextSibling);
    return;
  }
  snapshot.parent.appendChild(editorHost);
}

function measureVisibleContentLeft(viewportWidth: number): number {
  if (typeof document === 'undefined' || !document.body) return 0;

  const candidates = Array.from(document.body.querySelectorAll<HTMLElement>('*'));
  let minLeft = Number.POSITIVE_INFINITY;

  for (const element of candidates) {
    if (!element.isConnected) continue;
    if (element.id === WEB_EDITOR_V2_HOST_ID) continue;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
      continue;
    }
    if (rect.width < 24 || rect.height < 16) continue;
    if (rect.right <= 0 || rect.left >= viewportWidth) continue;

    const style = window.getComputedStyle(element);
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || style.opacity === '0'
      || style.position === 'fixed'
    ) {
      continue;
    }

    minLeft = Math.min(minLeft, rect.left);
  }

  return Number.isFinite(minLeft) ? Math.max(0, minLeft) : 0;
}

function applyPageZoom(remeasure = true): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!document.body || !document.documentElement) return;
  hoistEditorHostOutsideBodyTransform();

  const body = document.body;
  const html = document.documentElement;
  const viewportWidth = Math.max(0, window.innerWidth || html.clientWidth || 0);
  // Measure the page at its original layout, so transformed overflow cannot grow
  // the next fit measurement and repeated zooming does not drift.
  if (remeasure) {
    restoreInlineStyle(body.style, 'transform', state.bodySnapshots.get('transform'));
    restoreInlineStyle(body.style, 'transform-origin', state.bodySnapshots.get('transform-origin'));
    const originalStyle = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(body) : null;
    const originalTransform = state.bodySnapshots.get('transform')?.value || originalStyle?.transform || '';
    const [baseX = '0px', baseY = '0px'] = (originalStyle?.transformOrigin || '0px 0px').split(' ');
    baseTransform = originalTransform && originalTransform !== 'none'
      ? `translate(${baseX}, ${baseY}) ${originalTransform} translate(calc(-1 * ${baseX}), calc(-1 * ${baseY}))` : '';
    body.style.setProperty('transform', 'none', 'important');
    const origin = body.getBoundingClientRect?.();
    originX = (origin?.left ?? 0) + (window.scrollX || 0);
    originY = (origin?.top ?? 0) + (window.scrollY || 0);
    restoreInlineStyle(body.style, 'transform', state.bodySnapshots.get('transform'));
    contentWidth = Math.max(body.scrollWidth || 0, html.clientWidth || 0, viewportWidth);
    contentLeft = measureVisibleContentLeft(viewportWidth);
  }
  const reservedRightWidth = Math.max(0, Math.round(state.reservedRightWidth));
  const availableWidth = Math.max(0, viewportWidth - reservedRightWidth);
  const scale = manualScale ?? (contentWidth > 0 ? Math.min(1, availableWidth / contentWidth) : 1);
  const normalizedScale = Number.isFinite(scale) ? Math.max(0.01, scale) : 1;
  appliedScale = normalizedScale;
  appliedX = fitOffset(normalizedScale) + panX;

  body.style.setProperty('transform-origin', 'top left', 'important');
  body.style.setProperty(
    'transform',
    `translate(${appliedX}px, ${panY}px) scale(${normalizedScale}) ${baseTransform}`.trim(),
    'important',
  );
  html.style.setProperty('overflow-x', 'hidden', 'important');
  window.dispatchEvent(new Event(PAGE_LAYOUT_CHANGE_EVENT));
}

function attachResizeHandler(): void {
  if (typeof window === 'undefined' || state.resizeHandler) return;

  state.resizeHandler = () => {
    if (!state.enabled) return;
    applyPageZoom();
  };

  window.addEventListener('resize', state.resizeHandler);
}

function detachResizeHandler(): void {
  if (typeof window === 'undefined' || !state.resizeHandler) return;
  window.removeEventListener('resize', state.resizeHandler);
  state.resizeHandler = null;
}

export function setPageZoomEnabled(enabled: boolean, options: PageZoomOptions = {}): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!document.body || !document.documentElement) return;

  if (enabled && !state.enabled && nativeSuspension) {
    const snapshot = nativeSuspension; nativeSuspension = null;
    if (snapshot.body === document.body && snapshot.href === (window.location?.href ?? '')) {
      for (const [key, value] of snapshot.bodyStyles) restoreInlineStyle(document.body.style, key, value);
      for (const [key, value] of snapshot.htmlStyles) restoreInlineStyle(document.documentElement.style, key, value);
    }
  }

  const owner = options.owner ?? 'property-panel';
  if (enabled) reservations.set(owner, Math.max(0, options.reservedRightWidth ?? 0));
  else reservations.delete(owner);

  if (!reservations.size) {
    if (!state.enabled) return;
    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;
    restoreInlineStyle(bodyStyle, 'transform', state.bodySnapshots.get('transform'));
    restoreInlineStyle(bodyStyle, 'transform-origin', state.bodySnapshots.get('transform-origin'));
    restoreInlineStyle(htmlStyle, 'overflow-x', state.htmlSnapshots.get('overflow-x'));
    restoreEditorHostMount();
    detachResizeHandler();
    state.enabled = false;
    state.reservedRightWidth = 0;
    state.bodySnapshots.clear();
    state.htmlSnapshots.clear();
    manualScale = null; panX = 0; panY = 0; appliedScale = 1; appliedX = 0;
    window.dispatchEvent(new Event(PAGE_LAYOUT_CHANGE_EVENT));
    return;
  }

  captureSnapshots();
  state.enabled = true;
  state.reservedRightWidth = Math.max(...reservations.values());
  applyPageZoom();
  attachResizeHandler();
}
