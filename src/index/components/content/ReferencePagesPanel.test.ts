import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferencePagesPanel from './ReferencePagesPanel';
import { referenceRequest } from '../../domains/documentation/referencePagesClient';
vi.mock('../../domains/documentation/referencePagesClient', () => ({ referenceRequest: vi.fn() }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? React.createElement('div', {}, children) : null,
  DialogContent: 'div', DialogHeader: 'div', DialogTitle: 'h2', DialogDescription: 'p', DialogFooter: 'div',
}));
afterEach(() => vi.clearAllMocks());
const page = { id: 'ref-1', title: '示例', cacheDirectory: '/project/.axhub/make/references/ref-1', entryPath: 'home.html', htmlFiles: ['home.html'], createdAt: '', warnings: [], previewUrl: '' };
describe('reference list actions', () => {
  it('shows the source modification time in parentheses after the local publication label', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(ReferencePagesPanel, {
      projectId: 'p', pages: [{ ...page, sourceDirectory: '/publish', sourceModifiedAt: new Date(2026, 10, 8, 14, 30, 0).toISOString() }], loading: false,
      onSelect: vi.fn(), onImported: vi.fn(), onRefresh: vi.fn(), onDeleted: vi.fn(),
    })); });
    expect(JSON.stringify(view.toJSON())).toContain('本地发布（2026-11-08 14:30:00）');
    await act(async () => view.unmount());
  });
  it('confirms deletion, scopes the request, and removes the selected reference through its owner', async () => {
    const onDeleted = vi.fn(), onSelect = vi.fn();
    vi.mocked(referenceRequest).mockResolvedValue({ success: true });
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(ReferencePagesPanel, {
      projectId: 'p', pages: [page], loading: false, selectedId: page.id,
      onSelect, onImported: vi.fn(), onRefresh: vi.fn(), onDeleted,
    })); });
    await act(async () => view.root.findByProps({ 'aria-label': '删除参考页：示例' }).props.onClick());
    expect(referenceRequest).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain('将删除本地缓存');
    expect(JSON.stringify(view.toJSON())).toContain(page.cacheDirectory);
    const confirm = view.root.findAllByType('button').find(node => node.children.includes('确认删除'))!;
    await act(async () => confirm.props.onClick());
    expect(referenceRequest).toHaveBeenCalledWith('/api/reference-pages/ref-1?projectId=p', expect.objectContaining({ method: 'DELETE' }));
    expect(onDeleted).toHaveBeenCalledWith('ref-1');
    await act(async () => view.unmount());
  });
  it('offers local directory refresh and explains that deleting clears the project setting', async () => {
    const onRefresh = vi.fn();
    vi.mocked(referenceRequest).mockResolvedValue({ pages: [] });
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(ReferencePagesPanel, {
      projectId: 'p', pages: [{ ...page, sourceDirectory: '/local/export' }], loading: false,
      onSelect: vi.fn(), onImported: vi.fn(), onRefresh, onDeleted: vi.fn(),
    })); });
    await act(async () => view.root.findByProps({ 'aria-label': '刷新本地发布：示例' }).props.onClick());
    expect(referenceRequest).toHaveBeenCalledWith('/api/reference-pages/sync-local?projectId=p', expect.objectContaining({ method: 'POST' }));
    expect(onRefresh).toHaveBeenCalled();
    await act(async () => view.root.findByProps({ 'aria-label': '删除参考页：示例' }).props.onClick());
    expect(JSON.stringify(view.toJSON())).toContain('清除项目设置中的本地发布目录路径');
    expect(JSON.stringify(view.toJSON())).toContain('保留本地发布文件');
    await act(async () => view.unmount());
  });
  it('offers explicit restore for a deleted local publication', async () => {
    const onRefresh = vi.fn();
    vi.mocked(referenceRequest).mockResolvedValue({ pages: [page] });
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(ReferencePagesPanel, {
      projectId: 'p', pages: [], loading: false,
      localSource: { directory: '/local/export', suppressed: true },
      onSelect: vi.fn(), onImported: vi.fn(), onRefresh, onDeleted: vi.fn(),
    })); });
    const restore = view.root.findAllByType('button').find(node => node.children.includes('重新导入'))!;
    await act(async () => restore.props.onClick());
    expect(referenceRequest).toHaveBeenCalledWith('/api/reference-pages/sync-local?projectId=p', expect.objectContaining({ method: 'POST' }));
    expect(onRefresh).toHaveBeenCalled();
    await act(async () => view.unmount());
  });
});
