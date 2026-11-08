import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectAnnotationToolbar } from '../../../vendor/axhub-commentary/src/ui/runtime/annotation-toolbar-bridge';
import { RightEntryActions } from '../../../vendor/axhub-commentary/src/ui/runtime/right-entry';
import { isEditorPortalElement } from '../../../vendor/axhub-commentary/src/ui/shadow-host';

class Toolbar extends EventTarget {
  isConnected = true;
  attributes = new Map<string, string>();
  children: Toolbar[] = [];
  style = {};
  parent: Toolbar | null = null;
  panels: { click: () => void }[] = [];
  panelOpen = false;
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  append(child: Toolbar) { child.parent = this; this.children.push(child); }
  insertBefore(child: Toolbar) { this.append(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  contains(child: Toolbar) { return child === this || this.children.includes(child); }
  querySelector(selector: string) { return this.panelOpen && selector.includes('aria-pressed') ? this : null; }
  querySelectorAll() { return this.panels; }
}

afterEach(() => vi.unstubAllGlobals());

describe('unified right entry', () => {
  it('rechecks actual native panel state after an action with no DOM or aria changes', () => {
    const toolbar = new Toolbar(); let frame!: FrameRequestCallback;
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; }, cancelAnimationFrame: vi.fn() });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    const doc = { documentElement: {}, getElementById: () => ({ shadowRoot: { querySelector: () => toolbar } }), createElement: () => new Toolbar() };
    const panelsChanged = vi.fn();
    const bridge = connectAnnotationToolbar(doc as unknown as Document, vi.fn(), vi.fn(), panelsChanged);
    panelsChanged.mockClear(); toolbar.dispatchEvent(new Event('click'));
    expect(frame).toBeTypeOf('function'); frame(0);
    expect(panelsChanged).toHaveBeenLastCalledWith(false);
    bridge.dispose();
  });
  it('recognizes portal controls as editor UI so component deletion and save hotkeys ignore them', () => {
    class PortalElement {
      constructor(readonly inPortal: boolean) {}
      closest(selector: string) { return this.inPortal && selector === '[data-we-right-entry-slot="true"]' ? this : null; }
    }
    vi.stubGlobal('Element', PortalElement);
    expect(isEditorPortalElement(new PortalElement(true))).toBe(true);
    expect(isEditorPortalElement(new PortalElement(false))).toBe(false);
    expect(isEditorPortalElement(null)).toBe(false);
  });

  it('joins the existing toolbar, switches panels, and releases only its own slot', () => {
    let toolbar: Toolbar | null = new Toolbar();
    const nativeAction = new Toolbar(); toolbar.append(nativeAction);
    const shadow = { querySelector: () => toolbar };
    const observe = vi.fn(); const disconnect = vi.fn();
    let notify = () => {};
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe; disconnect = disconnect;
    });
    const doc = { documentElement: {}, getElementById: () => ({ shadowRoot: shadow }), createElement: () => new Toolbar() };
    const changed = vi.fn(); const nativeOpen = vi.fn(); const panelsChanged = vi.fn();
    const bridge = connectAnnotationToolbar(doc as unknown as Document, changed, nativeOpen, panelsChanged);
    expect(panelsChanged).toHaveBeenLastCalledWith(false);
    toolbar.panelOpen = true; notify();
    expect(panelsChanged).toHaveBeenLastCalledWith(true);
    toolbar.panelOpen = false; notify();
    expect(changed).toHaveBeenLastCalledWith(toolbar.children[1]);
    expect(toolbar.children).toContain(nativeAction);
    expect(toolbar.getAttribute('data-we-selection-lock-root')).toBe('true');
    toolbar.dispatchEvent(new Event('click'));
    expect(nativeOpen).toHaveBeenCalledOnce();
    nativeOpen.mockClear();
    const close = vi.fn(() => toolbar?.dispatchEvent(new Event('click')));
    toolbar.panels = [{ click: close }];
    bridge.closePanels();
    expect(close).toHaveBeenCalledOnce();
    expect(nativeOpen).not.toHaveBeenCalled();
    const original = toolbar;
    toolbar = null; notify();
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(original.children).toEqual([nativeAction]);
    toolbar = new Toolbar(); notify();
    expect(changed).toHaveBeenLastCalledWith(toolbar.children[0]);
    bridge.dispose();
    expect(toolbar.children).toEqual([]);
    expect(toolbar.getAttribute('data-we-selection-lock-root')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it('retains one shared fallback and exposes toggle state and shortcuts', async () => {
    const toggle = vi.fn(); const shortcuts = vi.fn();
    const view = create(React.createElement(RightEntryActions, { open: true, onToggle: toggle, onShortcuts: shortcuts }));
    const entry = view.root.findByProps({ 'aria-label': '批注列表' });
    expect(entry.props['aria-expanded']).toBe(true);
    await act(async () => entry.props.onClick());
    await act(async () => view.root.findByProps({ 'aria-label': '快捷键' }).props.onClick());
    expect(toggle).toHaveBeenCalledOnce(); expect(shortcuts).toHaveBeenCalledOnce();
    expect(view.root.findAllByProps({ 'data-we-right-entry': 'true' })).toHaveLength(1);
    await act(async () => view.unmount());
  });
});
