import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create } from 'react-test-renderer';

import { createInteractionService } from '../../../vendor/axhub-commentary/src/core/editor/interaction';
import { createEditorRuntimeState, DEFAULT_MODIFIERS, resetEditorTransientState } from '../../../vendor/axhub-commentary/src/core/editor/state';
import { createEventController } from '../../../vendor/axhub-commentary/src/core/event-controller';
import { getSelectionActionTargets } from '../../../vendor/axhub-commentary/src/core/editor/element-selection';
import { restoreSelectionModeFromCommandHover, restoreSelectionModeFromOutsidePointerDown, useOutsideClickSelectionRestore } from '../../../vendor/axhub-commentary/src/ui/runtime/runtime-effects/use-outside-click-selection-restore';
import { createPositionTracker } from '../../../vendor/axhub-commentary/src/core/position-tracker';
import { createChangesService, filterVisibleChangeMarkerMetas } from '../../../vendor/axhub-commentary/src/core/editor/changes';
import type { ElementEditMeta } from '../../../vendor/axhub-commentary/src/core/editor/state';

function setup() {
  const state = createEditorRuntimeState();
  const changes = {
    rememberSelectionAnchor: vi.fn(), clearPendingSelectionAnchor: vi.fn(), renderChangeMarkers: vi.fn(),
    getMetaForElement: (target: Element | null) => target ? state.editMetaByKey.get(target.tagName) ?? null : null,
  };
  const service = createInteractionService({
    state,
    changes: changes as never,
    agentBridge: { isElementInteractionLocked: (element: Element | null) => element?.getAttribute('locked') === 'true' } as never,
    persistence: {} as never,
    textSession: {} as never,
    logPrefix: '[test]',
  });
  return { state, service };
}

function element(name: string, connected = true) {
  return { tagName: name, isConnected: connected, getAttribute: () => null } as unknown as Element;
}

const command = { ...DEFAULT_MODIFIERS, meta: true };

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('element annotation multi-selection', () => {
  it('adds Command-clicked elements without discarding the existing selection', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    expect(state.selectedElements).toEqual([first, second]);
    expect(state.selectedElement).toBe(second);
  });

  it('toggles an existing member off and keeps the remaining element active', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    await service.handleSelect(second, command);
    expect(state.selectedElements).toEqual([first]);
    expect(state.selectedElement).toBe(first);
  });

  it('clears selection when Command-click removes its last member', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    await service.handleSelect(first, command);
    await service.handleSelect(first, command);
    expect(state.selectedElements).toEqual([]);
    expect(state.selectedElement).toBeNull();
  });

  it('replaces the group on an ordinary selection', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    const third = element('LABEL');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    await service.handleSelect(third, DEFAULT_MODIFIERS);
    expect(state.selectedElements).toEqual([third]);
  });

  it('drops detached elements and ignores disconnected or locked new targets', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    Object.assign(first, { isConnected: false });
    await service.handleSelect(second, command);
    await service.handleSelect(element('DIV', false), command);
    const locked = element('DIV');
    locked.getAttribute = () => 'true';
    await service.handleSelect(locked, command);
    expect(state.selectedElements).toEqual([second]);
  });

  it('clears the complete group on deselection and runtime reset', async () => {
    const { state, service } = setup();
    await service.handleSelect(element('BUTTON'), DEFAULT_MODIFIERS);
    await service.handleSelect(element('INPUT'), command);
    service.handleDeselect();
    expect(state.selectedElements).toEqual([]);
    await service.handleSelect(element('BUTTON'), command);
    resetEditorTransientState(state);
    expect(state.selectedElements).toEqual([]);
  });

  it('resolves all selected targets for a group action and isolates unrelated targets', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    const unrelated = element('LABEL');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    expect(getSelectionActionTargets(state, second)).toEqual([first, second]);
    expect(getSelectionActionTargets(state, unrelated)).toEqual([unrelated]);
    Object.assign(first, { isConnected: false });
    expect(getSelectionActionTargets(state, second)).toEqual([second]);
  });

  it('saves a draft to its original group after selection has been cleared', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    const draftTargets = state.selectedElements.slice();
    service.handleDeselect();
    expect(getSelectionActionTargets(state, second, draftTargets)).toEqual([first, second]);
  });

  it('preserves surviving draft targets when its active anchor is removed', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    const draftTargets = state.selectedElements.slice();
    Object.assign(second, { isConnected: false });
    expect(getSelectionActionTargets(state, second, draftTargets)).toEqual([first]);
  });

  it('hides the finished group’s numbered markers without deleting saved comments', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    const metas = ['BUTTON', 'INPUT', 'UNRELATED'].map((elementKey) => ({
      elementKey, note: '保留已保存的评论',
    }) as ElementEditMeta);
    for (const meta of metas) state.editMetaByKey.set(meta.elementKey, meta);
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    service.clearSelection();
    expect(filterVisibleChangeMarkerMetas(metas, null, state.dismissedSelectionMarkerKeys))
      .toEqual([metas[2]]);
    expect(state.editMetaByKey.size).toBe(3);
    expect(metas.map((meta) => meta.note)).toEqual(Array(3).fill('保留已保存的评论'));
  });

  it('also cleans group numbering on pointer deselection and resets it for a new session', async () => {
    const { state, service } = setup();
    state.editMetaByKey.set('BUTTON', { elementKey: 'BUTTON' } as ElementEditMeta);
    state.editMetaByKey.set('INPUT', { elementKey: 'INPUT' } as ElementEditMeta);
    await service.handleSelect(element('BUTTON'), DEFAULT_MODIFIERS);
    await service.handleSelect(element('INPUT'), command);
    service.handleDeselect();
    expect(state.dismissedSelectionMarkerKeys).toEqual(new Set(['BUTTON', 'INPUT']));
    await service.handleSelect(element('BUTTON'), DEFAULT_MODIFIERS);
    expect(state.dismissedSelectionMarkerKeys).toEqual(new Set(['INPUT']));
    resetEditorTransientState(state);
    expect(state.dismissedSelectionMarkerKeys.size).toBe(0);
  });

  it('lets an explicit show-markers action reveal comments, while internal toggles keep cleanup', () => {
    const state = createEditorRuntimeState();
    state.dismissedSelectionMarkerKeys.add('saved-comment');
    const changes = createChangesService({ state, scheduleCacheWrite: vi.fn(), persistMarkerVisibility: vi.fn() });
    changes.setChangeMarkersVisible(true, { persist: false });
    expect(state.dismissedSelectionMarkerKeys.has('saved-comment')).toBe(true);
    changes.setChangeMarkersVisible(true);
    expect(state.dismissedSelectionMarkerKeys.size).toBe(0);
  });

  it('cleans the entire session when Command-click removes members one by one', async () => {
    const { state, service } = setup();
    const first = element('BUTTON');
    const second = element('INPUT');
    const metas = ['BUTTON', 'INPUT'].map((elementKey) => ({ elementKey, note: '保留评论' }) as ElementEditMeta);
    for (const meta of metas) state.editMetaByKey.set(meta.elementKey, meta);
    await service.handleSelect(first, DEFAULT_MODIFIERS);
    await service.handleSelect(second, command);
    await service.handleSelect(second, command);
    await service.handleSelect(first, command);
    expect(filterVisibleChangeMarkerMetas(metas, null, state.dismissedSelectionMarkerKeys)).toEqual([]);
    expect(state.editMetaByKey.size).toBe(2);
  });
});

describe('Command-click event routing', () => {
  class PageElement extends EventTarget {
    isConnected = true;
    matches() { return false; }
    getAttribute() { return null; }
    hasAttribute() { return false; }
    closest() { return null; }
  }
  class PageMouseEvent extends Event {
    button = 0;
    clientX = 20;
    clientY = 30;
    altKey = false;
    shiftKey = false;
    ctrlKey = false;
    metaKey = false;
    constructor(type: string, meta = false) {
      super(type, { cancelable: true });
      this.metaKey = meta;
    }
  }

  function setupController({ promoteToParent = false, locked = false } = {}) {
    const doc = new EventTarget();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1440 }));
    vi.stubGlobal('Element', PageElement);
    vi.stubGlobal('HTMLElement', PageElement);
    vi.stubGlobal('MouseEvent', PageMouseEvent);
    vi.stubGlobal('PointerEvent', undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const selected = new PageElement();
    const target = new PageElement();
    const parent = new PageElement();
    const hitTest = vi.fn(() => target);
    Object.assign(doc, { elementFromPoint: hitTest });
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    const controller = createEventController({
      isOverlayElement: () => false,
      onHover, onSelect, onDeselect,
      getSelectedElement: () => selected as unknown as Element,
      findTargetForSelect: () => (promoteToParent ? parent : target) as unknown as Element,
      isElementInteractionLocked: (element) => locked && element === target as unknown as Element,
    });
    controller.setMode('selecting');
    return { doc, controller, onSelect, onDeselect, onHover, target, parent, hitTest };
  }

  it.each([false, true])('selects the hovered child instead of its larger parent (Command=%s)', (meta) => {
    const { doc, controller, onHover, onSelect, target } = setupController({ promoteToParent: true });
    try {
      controller.setMode('hover');
      doc.dispatchEvent(new PageMouseEvent('mousemove'));
      vi.mocked(requestAnimationFrame).mock.lastCall![0](0);
      expect(onHover).toHaveBeenLastCalledWith(target);
      doc.dispatchEvent(new PageMouseEvent('mousedown', meta));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: target }));
    } finally { controller.dispose(); }
  });

  it('rechecks the current pointer hit instead of selecting a stale hover target', () => {
    const { doc, controller, onSelect, target, hitTest } = setupController({ promoteToParent: true });
    try {
      controller.setMode('hover');
      doc.dispatchEvent(new PageMouseEvent('mousemove'));
      vi.mocked(requestAnimationFrame).mock.lastCall![0](0);
      const nextTarget = new PageElement();
      hitTest.mockReturnValue(nextTarget);
      doc.dispatchEvent(new PageMouseEvent('mousedown'));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: nextTarget }));
      expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ element: target }));
    } finally { controller.dispose(); }
  });

  it('still allows explicit Alt-click parent selection', () => {
    const { doc, controller, onSelect, parent } = setupController({ promoteToParent: true });
    try {
      controller.setMode('hover');
      doc.dispatchEvent(Object.assign(new PageMouseEvent('mousedown'), { altKey: true }));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: parent }));
    } finally { controller.dispose(); }
  });

  it('does not promote a locked pointer target into an unlocked parent', () => {
    const { doc, controller, onSelect } = setupController({ promoteToParent: true, locked: true });
    try {
      controller.setMode('hover');
      doc.dispatchEvent(new PageMouseEvent('mousedown'));
      expect(onSelect).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('routes a Command-click directly to selection without deselecting first', () => {
    const { doc, controller, onSelect, onDeselect, target } = setupController();
    try {
      const click = new PageMouseEvent('mousedown', true);
      doc.dispatchEvent(click);
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: target, modifiers: command }));
      expect(onDeselect).not.toHaveBeenCalled();
      expect(controller.getMode()).toBe('selecting');
      expect(click.defaultPrevented).toBe(true);
    } finally { controller.dispose(); }
  });

  it('keeps the existing ordinary-click deselection behavior and Escape handling', () => {
    const { doc, controller, onSelect, onDeselect } = setupController();
    try {
      doc.dispatchEvent(new PageMouseEvent('mousedown'));
      expect(onSelect).not.toHaveBeenCalled();
      expect(onDeselect).toHaveBeenCalledTimes(1);
      controller.setMode('selecting');
      doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
      expect(controller.getMode()).toBe('hover');
      expect(onDeselect).toHaveBeenCalledTimes(2);
    } finally { controller.dispose(); }
  });

  it('allows the same Command-click to reach selection when the prompt temporarily paused picking', () => {
    setupController().controller.dispose();
    const event = new PageMouseEvent('pointerdown', true);
    const syncSelectionModeAvailability = vi.fn();
    restoreSelectionModeFromOutsidePointerDown({
      event: event as unknown as PointerEvent,
      selectionInteractionLockOwnersRef: { current: new Set() },
      selectionHoverOwnersRef: { current: new Set() },
      selectionNeedsExplicitReactivateRef: { current: true },
      syncSelectionModeAvailability,
    });
    expect(syncSelectionModeAvailability).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('previews the next Command-hover target while the comment card has paused picking', () => {
    const { doc, controller, onHover, onSelect, onDeselect, target } = setupController();
    const event = Object.assign(new PageMouseEvent('mousemove', true), { buttons: 0 });
    const needsReactivate = { current: true };
    const locks = { current: new Set<'prompt' | 'panel'>(['prompt']) };
    const hoverOwners = { current: new Set<'prompt' | 'panel'>() };
    const restoreOptions = {
      selectionNeedsExplicitReactivateRef: needsReactivate,
      selectionInteractionLockOwnersRef: locks,
      selectionHoverOwnersRef: hoverOwners,
      syncSelectionModeAvailability: () => controller.setMode('selecting'),
    };
    function SelectionRestoreListener() {
      useOutsideClickSelectionRestore(restoreOptions);
      return null;
    }
    let view: ReturnType<typeof create> | undefined;
    try {
      controller.setMode('interaction', { allowPageInteraction: false });
      act(() => { view = create(React.createElement(SelectionRestoreListener)); });
      window.dispatchEvent(event);
      doc.dispatchEvent(event);
      vi.mocked(requestAnimationFrame).mock.lastCall![0](0);
      expect(onHover).toHaveBeenLastCalledWith(target);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onDeselect).not.toHaveBeenCalled();
      expect(needsReactivate.current).toBe(false);
      expect(locks.current.size).toBe(0);
      expect(event.defaultPrevented).toBe(true); // Document still blocks prototype interaction.
      act(() => view!.unmount());
      needsReactivate.current = true;
      window.dispatchEvent(Object.assign(new PageMouseEvent('mousemove', true), { buttons: 0 }));
      expect(needsReactivate.current).toBe(true);
    } finally {
      act(() => view?.unmount());
      controller.dispose();
    }
  });

  it.each([{ meta: false, buttons: 0 }, { meta: true, buttons: 1 }])(
    'keeps picking paused for ordinary movement or dragging (%j)', ({ meta, buttons }) => {
      setupController().controller.dispose();
      const needsReactivate = { current: true };
      const sync = vi.fn();
      const result = restoreSelectionModeFromCommandHover({
        event: Object.assign(new PageMouseEvent('mousemove', meta), { buttons }) as unknown as PointerEvent,
        selectionNeedsExplicitReactivateRef: needsReactivate,
        selectionInteractionLockOwnersRef: { current: new Set() },
        selectionHoverOwnersRef: { current: new Set() },
        syncSelectionModeAvailability: sync,
      });
      expect(result).toBe(false);
      expect(needsReactivate.current).toBe(true);
      expect(sync).not.toHaveBeenCalled();
    },
  );

  it('does not restore page picking when Command-hovering inside the comment popup', () => {
    setupController().controller.dispose();
    const popup = new PageElement();
    popup.hasAttribute = () => true;
    const event = Object.assign(new PageMouseEvent('mousemove', true), {
      buttons: 0, composedPath: () => [popup],
    });
    const sync = vi.fn();
    expect(restoreSelectionModeFromCommandHover({
      event: event as unknown as PointerEvent,
      selectionNeedsExplicitReactivateRef: { current: true },
      selectionInteractionLockOwnersRef: { current: new Set(['prompt']) },
      selectionHoverOwnersRef: { current: new Set(['prompt']) },
      syncSelectionModeAvailability: sync,
    })).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it('updates secondary outlines when their positions change independently', () => {
    setupController().controller.dispose();
    class Observer { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('MutationObserver', Observer);
    vi.stubGlobal('ShadowRoot', class {});
    vi.stubGlobal('Document', EventTarget);
    const main = Object.assign(new PageElement(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    });
    let top = 50;
    const secondary = Object.assign(new PageElement(), {
      getBoundingClientRect: () => ({ left: 0, top, width: 100, height: 40 }),
    });
    const onPositionUpdate = vi.fn();
    const tracker = createPositionTracker({
      onPositionUpdate,
      getAdditionalSelectionElements: () => [secondary as unknown as Element],
    });
    try {
      tracker.setSelectionElement(main as unknown as Element);
      tracker.forceUpdate(true);
      onPositionUpdate.mockClear();
      top = 150;
      tracker.forceUpdate();
      expect(onPositionUpdate).toHaveBeenCalledWith(expect.objectContaining({
        additionalSelections: [{ left: 0, top: 150, width: 100, height: 40 }],
      }));
      secondary.isConnected = false;
      tracker.forceUpdate();
      expect(onPositionUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ additionalSelections: [] }));
    } finally { tracker.dispose(); }
  });
});
