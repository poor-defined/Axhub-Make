import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ComponentCommentComposer } from '../../../vendor/axhub-commentary/src/ui/runtime/component-comment-composer';
import { createComponentCommentStore, type ComponentCommentApi } from '../../../vendor/axhub-commentary/src/core/editor/component-comments';

vi.mock('@ant-design/icons', () => ({ ArrowUpOutlined: () => null, ExportOutlined: () => null, LoadingOutlined: () => null }));

async function setup() {
  const element = { isConnected: true } as Element;
  const target = { elementKey: 'button', label: '按钮', locator: { selectors: ['button'], fingerprint: 'button', path: [0] } };
  const records = new Map(); const persist = vi.fn(async () => {}); const run = vi.fn(async () => {}); const exporting = vi.fn(async () => {});
  const store = createComponentCommentStore({ records, getScope: () => 'page', persist });
  const api: ComponentCommentApi = {
    getScopeKey: () => 'page', getDraft: (_, purpose) => store.getDraft(target, purpose),
    updateDraft: (_, purpose, patch) => store.updateDraft(target, purpose, patch),
    saveDraft: (_, purpose) => store.saveDraft(target, purpose), startNew: (_, purpose) => store.startNew(target, purpose),
    run, remove: store.remove, removeMany: store.removeMany, edit: id => ({ element, purpose: store.edit(id) }),
  };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(ComponentCommentComposer, {
    api, element, label: '按钮', onClose: vi.fn(), onSaved: vi.fn(), onExport: exporting,
    available: { 'modify-prototype': true, 'generate-prototype': true, 'document-component': true },
  })); });
  const input = () => view.root.findByProps({ 'aria-label': '给 AI 的指示' });
  const type = async (value: string) => { await act(async () => input().props.onChange({ target: { value } })); };
  const tab = async (name: string) => { await act(async () => view.root.findByProps({ role: 'tab', 'aria-label': name }).props.onClick()); };
  const click = async (name: string) => { await act(async () => view.root.findByProps({ 'aria-label': name }).props.onClick()); };
  return { view, input, type, tab, click, records, persist, run, exporting };
}
describe('component comment purpose tabs', () => {
  it('allows empty saves in every purpose while keeping direct send disabled until instructions are entered', async () => {
    const s = await setup();
    for (const label of ['修改原型', '生成新原型', '引入说明']) {
      await s.tab(label);
      expect(s.view.root.findByProps({ 'aria-label': '暂存批注' }).props.disabled).toBe(false);
      expect(s.view.root.findByProps({ 'aria-label': '发送' }).props.disabled).toBe(true);
      await s.click('暂存批注');
    }
    expect(s.records.size).toBe(3);
    expect([...s.records.values()].every(record => record.entry.comment === '')).toBe(true);
    expect(s.run).not.toHaveBeenCalled();
    await act(async () => s.view.unmount());
  });
  it('can retry a failed empty save without filling in instructions', async () => {
    const s = await setup(); s.persist.mockRejectedValueOnce(new Error('offline'));
    await s.click('暂存批注'); expect(s.records.size).toBe(0);
    expect(s.view.root.findByProps({ role: 'alert' }).children).toContain('offline');
    expect(s.view.root.findByProps({ 'aria-label': '暂存批注' }).props.disabled).toBe(false);
    await s.click('暂存批注'); expect(s.records.size).toBe(1);
    await act(async () => s.view.unmount());
  });
  it('isolates three drafts and saves multiple annotations on the same component', async () => {
    const s = await setup();
    expect(s.view.root.findAllByProps({ role: 'tab' })).toHaveLength(3);
    await s.type('修改 A'); await s.tab('生成新原型'); expect(s.input().props.value).toBe('');
    await s.type('生成 B'); await s.tab('引入说明'); await s.type('说明 C');
    await s.tab('修改原型'); expect(s.input().props.value).toBe('修改 A');
    await s.click('暂存批注'); expect(s.input().props.value).toBe('');
    await s.type('修改 D'); await s.click('暂存批注');
    expect([...s.records.values()].map(record => record.entry.comment)).toEqual(['修改 A', '修改 D']);
    await s.tab('生成新原型'); expect(s.input().props.value).toBe('生成 B');
    await act(async () => s.view.unmount());
  });
  it('sends only the active purpose and export leaves its draft untouched', async () => {
    const s = await setup(); await s.tab('引入说明'); await s.type('说明');
    await s.click('导出组件'); expect(s.exporting).toHaveBeenCalledOnce(); expect(s.persist).not.toHaveBeenCalled();
    expect(s.input().props.value).toBe('说明');
    await s.click('发送');
    expect(s.run).toHaveBeenCalledWith('document', [expect.any(String)]);
    expect([...s.records.values()][0].entry.purpose).toBe('document-component');
    await act(async () => s.view.unmount());
  });
  it('retains the failed draft and displays a retryable save error', async () => {
    const s = await setup(); await s.type('请保留'); s.persist.mockRejectedValueOnce(new Error('offline'));
    await s.click('暂存批注'); expect(s.input().props.value).toBe('请保留');
    expect(s.view.root.findByProps({ role: 'alert' }).children).toContain('offline');
    await s.click('暂存批注'); expect(s.records.size).toBe(1);
    await act(async () => s.view.unmount());
  });
  it('routes the keyboard shortcut to the current purpose and ignores composition', async () => {
    const s = await setup(); await s.tab('生成新原型'); await s.type('两种状态');
    const keyboard = s.view.root.findByProps({ 'aria-label': '组件批注' }).props.onKeyDown;
    const event = { key: 'Enter', ctrlKey: true, metaKey: false, nativeEvent: { isComposing: true }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => keyboard(event)); expect(s.run).not.toHaveBeenCalled();
    await act(async () => keyboard({ ...event, nativeEvent: { isComposing: false } }));
    expect(s.run).toHaveBeenCalledWith('generate', [expect.any(String)]);
    await act(async () => s.view.unmount());
  });
});
