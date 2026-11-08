import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentListView, CommentListEntryButton } from '../../../vendor/axhub-commentary/src/ui/runtime/comment-list-view';
import type { CommentListEntry } from '../../../vendor/axhub-commentary/src/core/editor/comment-batch';
import { restoreSelectionModeFromOutsidePointerDown } from '../../../vendor/axhub-commentary/src/ui/runtime/runtime-effects/use-outside-click-selection-restore';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const entries: CommentListEntry[] = ['one', 'two', 'three'].map(id => ({ id, label: id, note: `${id} note`, element: { isConnected: true } as Element }));
async function setup(initial = entries) {
  const run = vi.fn(async (_action: string, _ids: readonly string[]) => {});
  const locate = vi.fn(); const close = vi.fn(); const interaction = vi.fn();
  let current = initial; let view!: ReactTestRenderer;
  const props = { getEntries: () => current, onRun: run, onLocate: locate, onClose: close, onInteractionChange: interaction, sendAvailable: true, generateAvailable: true, documentAvailable: true };
  await act(async () => { view = create(React.createElement(CommentListView, props)); });
  return { view, run, locate, close, setEntries: (next: CommentListEntry[]) => { current = next; } };
}
describe('right comment list', () => {
  it('does not prune shared selection in the hidden iframe copy during a slow hosted deletion', async () => {
    vi.useFakeTimers(); let current = entries; const changed = vi.fn(); let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, { getEntries: () => current, hidden: true, selectedIds: ['one'], onSelectionChange: changed,
      onRun: vi.fn(), onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true })); });
    current = []; await act(async () => { vi.advanceTimersByTime(1000); });
    expect(changed).not.toHaveBeenCalled();
    current = entries; await act(async () => { vi.advanceTimersByTime(500); });
    expect(view.root.findByProps({ 'aria-label': '选择批注 one' }).props.checked).toBe(true);
    await act(async () => view.unmount());
  });
  it('pins the real list and keeps its selection when hidden and reopened', async () => {
    const pin = vi.fn(); let view!: ReactTestRenderer;
    const props = { getEntries: () => entries, onRun: vi.fn(), onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true, onPinnedChange: pin, pinned: false };
    await act(async () => { view = create(React.createElement(CommentListView, props)); });
    await act(async () => view.root.findByProps({ 'aria-label': '固定批注列表到右侧' }).props.onClick());
    expect(pin).toHaveBeenCalledWith(true);
    await act(async () => view.root.findByProps({ 'aria-label': '选择批注 one' }).props.onChange());
    await act(async () => view.update(React.createElement(CommentListView, { ...props, hidden: true, pinned: true })));
    expect(view.root.findByType('aside').props.hidden).toBe(true);
    await act(async () => view.update(React.createElement(CommentListView, { ...props, pinned: true })));
    expect(view.root.findByType('aside').props['data-pinned']).toBe(true);
    expect(view.root.findByProps({ 'aria-label': '选择批注 one' }).props.checked).toBe(true);
    await act(async () => view.unmount());
  });
  it('confirms mixed-purpose selected deletion, keeps selection after failure, and allows deleting stale components', async () => {
    const typed = [{ ...entries[0], purpose: 'modify-prototype' }, { ...entries[1], purpose: 'generate-prototype', element: null, disabledReason: '组件已失效' }, { ...entries[2], purpose: 'modify-prototype', state: 'editing' as const }];
    const removeMany = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (ids: string[]) => { current = current.filter(entry => !ids.includes(entry.id)); });
    let current = typed; let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, { getEntries: () => current, onRun: vi.fn(), onEdit: vi.fn(), onRemoveMany: removeMany,
      onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true })); });
    await act(async () => view.root.findByProps({ 'aria-label': '全选批注' }).props.onChange());
    expect(view.root.findByProps({ 'aria-label': '选择批注 two' }).props.checked).toBe(true);
    expect(view.root.findByProps({ 'aria-label': '选择批注 three' }).props.disabled).toBe(true);
    expect(view.root.findByProps({ 'aria-label': '发送所选批注' }).props.disabled).toBe(true);
    await act(async () => view.root.findByProps({ 'aria-label': '删除所选批注' }).props.onClick());
    expect(removeMany).not.toHaveBeenCalled();
    expect(view.root.findByProps({ role: 'alertdialog' })).toBeTruthy();
    await act(async () => view.root.findByProps({ 'aria-label': '取消删除批注' }).props.onClick());
    expect(removeMany).not.toHaveBeenCalled();
    await act(async () => view.root.findByProps({ 'aria-label': '删除所选批注' }).props.onClick());
    await act(async () => view.root.findByProps({ 'aria-label': '确认删除批注' }).props.onClick());
    expect(view.root.findByProps({ 'aria-label': '选择批注 one' }).props.checked).toBe(true);
    expect(JSON.stringify(view.toJSON())).toContain('offline');
    await act(async () => view.root.findByProps({ 'aria-label': '确认删除批注' }).props.onClick());
    expect(removeMany).toHaveBeenLastCalledWith(['one', 'two']);
    expect(view.root.findAllByProps({ 'aria-label': '选择批注 one' })).toHaveLength(0);
    expect(view.root.findByProps({ 'aria-label': '选择批注 three' })).toBeTruthy();
    await act(async () => view.unmount());
  });
  it('shows independent purpose records and only permits a matching batch action', async () => {
    const typed: CommentListEntry[] = [
      { ...entries[0], purpose: 'modify-prototype' }, { ...entries[1], purpose: 'generate-prototype' },
    ];
    const run = vi.fn(), edit = vi.fn(), remove = vi.fn(); let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, { getEntries: () => typed, onRun: run,
      onEdit: edit, onRemove: remove, onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true })); });
    await act(async () => view.root.findByProps({ 'aria-label': '选择批注 one' }).props.onChange());
    await act(async () => view.root.findByProps({ 'aria-label': '发送所选批注' }).props.onClick());
    expect(run).toHaveBeenCalledWith('send', ['one']);
    await act(async () => view.root.findByProps({ 'aria-label': '选择批注 two' }).props.onChange());
    expect(view.root.findByProps({ 'aria-label': '发送所选批注' }).props.disabled).toBe(true);
    expect(JSON.stringify(view.toJSON())).toContain('用途');
    await act(async () => view.root.findByProps({ 'aria-label': '编辑批注 one' }).props.onClick());
    expect(edit).toHaveBeenCalledWith('one');
    await act(async () => view.unmount());
  });
  it('filters records by purpose without offering legacy migration', async () => {
    const typed = [{ ...entries[0], purpose: 'modify-prototype' }, { ...entries[1], purpose: 'generate-prototype' }, entries[2]];
    const edit = vi.fn(); let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, { getEntries: () => typed, onRun: vi.fn(), onEdit: edit,
      onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true })); });
    await act(async () => view.root.findByProps({ 'aria-label': '筛选批注用途' }).props.onChange({ target: { value: 'generate-prototype' } }));
    expect(view.root.findAllByProps({ 'aria-label': '选择批注 one' })).toHaveLength(0);
    expect(view.root.findAllByProps({ 'aria-label': '选择批注 two' })).toHaveLength(1);
    expect(view.root.findAllByProps({ value: 'legacy' })).toHaveLength(0);
    expect(view.root.findAllByProps({ 'aria-label': '选择历史批注用途 three' })).toHaveLength(0);
    await act(async () => view.unmount());
  });
  it('clears old page selections even when a fast restore reuses the same element IDs', async () => {
    vi.useFakeTimers(); let revision = 1; let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, {
      getEntries: () => entries, getLoadState: () => ({ status: 'ready' as const, revision }),
      onRun: vi.fn(), onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true,
    })); });
    await act(async () => view.root.findByProps({ 'aria-label': '选择批注 one' }).props.onChange());
    revision = 2;
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(view.root.findByProps({ 'aria-label': '选择批注 one' }).props.checked).toBe(false);
    await act(async () => view.unmount());
  });
  it('shows the supplied list skeleton while saved comments hydrate and exposes retry after failure', async () => {
    vi.useFakeTimers();
    let state: { status: 'loading' | 'ready' | 'error'; error?: string } = { status: 'loading' };
    const retry = vi.fn(async () => { state = { status: 'ready' }; });
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListView, {
      getEntries: () => [], getLoadState: () => state, onRetry: retry,
      loadingContent: React.createElement('div', { 'data-page-skeleton': 'list' }),
      onRun: vi.fn(), onClose: vi.fn(), onInteractionChange: vi.fn(), sendAvailable: true, generateAvailable: true, documentAvailable: true,
    })); });
    expect(view.root.findByProps({ 'data-page-skeleton': 'list' })).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toContain('暂无批注');
    state = { status: 'error', error: 'restore failed' };
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(view.root.findByProps({ role: 'alert' }).children).toContain('restore failed');
    expect(view.root.findAllByProps({ 'data-page-skeleton': 'list' })).toHaveLength(0);
    await act(async () => { await view.root.findByProps({ 'aria-label': '重试加载批注' }).props.onClick(); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(retry).toHaveBeenCalledOnce(); expect(JSON.stringify(view.toJSON())).toContain('暂无批注');
    await act(async () => view.unmount());
  });
  it('allows the edge entry click through the selection restore guard on the first click', async () => {
    const open = vi.fn(); let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(CommentListEntryButton, { onClick: open })); });
    const button = view.root.findByType('button');
    class ButtonElement extends EventTarget {
      hasAttribute(name: string) { return button.props[name] !== undefined; }
      getAttribute(name: string) { return button.props[name] ?? null; }
      closest() { return null; }
    }
    vi.stubGlobal('Element', ButtonElement);
    const event = { composedPath: () => [new ButtonElement()], preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
    expect(restoreSelectionModeFromOutsidePointerDown({ event, selectionInteractionLockOwnersRef: { current: new Set() }, selectionHoverOwnersRef: { current: new Set() }, selectionNeedsExplicitReactivateRef: { current: true }, syncSelectionModeAvailability: vi.fn() })).toBe(false);
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    await act(async () => button.props.onClick());
    expect(open).toHaveBeenCalledOnce();
    await act(async () => view.unmount());
  });
  it('selects individual comments and independently invokes all three actions with the same membership', async () => {
    const s = await setup();
    const check = (id: string) => s.view.root.findByProps({ 'aria-label': `选择批注 ${id}` });
    await act(async () => { check('one').props.onChange(); check('two').props.onChange(); });
    for (const [label, action] of [['发送修改', 'send'], ['生成原型', 'generate'], ['引入说明', 'document']]) {
      const button = s.view.root.findByProps({ 'aria-label': label });
      expect(button.props.disabled).toBe(false);
      await act(async () => { await button.props.onClick(); });
      expect(s.run).toHaveBeenLastCalledWith(action, ['one', 'two']);
    }
    expect(check('one').props.checked).toBe(true);
    expect(s.locate).not.toHaveBeenCalled();
    await act(async () => s.view.unmount());
  });
  it('supports select all and clear all, excluding unavailable comments', async () => {
    const s = await setup([...entries, { ...entries[0], id: 'stale', label: 'stale', element: null, disabledReason: '组件已失效' }]);
    const all = () => s.view.root.findByProps({ 'aria-label': '全选批注' });
    await act(async () => all().props.onChange());
    await act(async () => s.view.root.findByProps({ 'aria-label': '发送修改' }).props.onClick());
    expect(s.run).toHaveBeenCalledWith('send', ['one', 'two', 'three']);
    await act(async () => all().props.onChange());
    expect(s.view.root.findByProps({ 'aria-label': '发送修改' }).props.disabled).toBe(true);
    await act(async () => s.view.unmount());
  });
  it('displays failure and keeps selected comments available for retry', async () => {
    const s = await setup(); s.run.mockRejectedValueOnce(new Error('Host rejected'));
    await act(async () => s.view.root.findByProps({ 'aria-label': '选择批注 one' }).props.onChange());
    await act(async () => s.view.root.findByProps({ 'aria-label': '发送修改' }).props.onClick());
    expect(s.view.root.findByProps({ role: 'alert' }).children).toContain('Host rejected');
    expect(s.view.root.findByProps({ 'aria-label': '选择批注 one' }).props.checked).toBe(true);
    await act(async () => s.view.unmount());
  });
  it('updates saved comments and clears removed selections without showing old page content', async () => {
    vi.useFakeTimers(); const s = await setup();
    await act(async () => s.view.root.findByProps({ 'aria-label': '全选批注' }).props.onChange());
    s.setEntries([]);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(JSON.stringify(s.view.toJSON())).toContain('暂无批注');
    expect(s.view.root.findByProps({ 'aria-label': '发送修改' }).props.disabled).toBe(true);
    await act(async () => s.view.unmount());
  });
});
