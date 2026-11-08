import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReferencePageView from './ReferencePageView';
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? React.createElement('div', {}, children) : null),
  DialogContent: 'div',
  DialogHeader: 'div',
  DialogTitle: 'h2',
  DialogDescription: 'p',
  DialogFooter: 'div',
}));
const page = {
  id: 'a',
  title: '参考',
  entryPath: 'orders.html',
  htmlFiles: ['orders.html', 'details.html'],
  createdAt: '',
  warnings: [],
  previewUrl: '/api/projects/p/reference-pages/a/files/orders.html',
};
afterEach(() => vi.unstubAllGlobals());
describe('isolated reference workspace', () => {
  it('uses an opaque frame, validates message source, and fixes persistence to the displayed reference', async () => {
    const listeners = new Set<(event: any) => void>();
    const postMessage = vi.fn(),
      onDocumentComponent = vi.fn(),
      onGeneratePrototype = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', {
      location: { origin: 'http://make.test' },
      addEventListener: (_name: string, fn: any) => listeners.add(fn),
      removeEventListener: (_name: string, fn: any) => listeners.delete(fn),
    });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ exists: false }) });
    vi.stubGlobal('fetch', fetcher);
    const child = { postMessage };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(ReferencePageView, {
          projectId: 'p',
          page,
          onDocumentComponent,
          onGeneratePrototype,
        }),
        {
          createNodeMock: (element) =>
            element.type === 'iframe' ? { contentWindow: child } : null,
        },
      );
    });
    const frame = renderer.root.findByType('iframe');
    expect(frame.props.sandbox).toBe('allow-scripts');
    await act(async () => {
      frame.props.onLoad();
    });
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          referenceSandbox: true,
          documentPath: '.axhub/make/references/a/files/orders.html',
        }),
      }),
      '*',
    );
    const message = async (data: any, source: any = child, origin = 'null') =>
      act(async () => {
        listeners.forEach((fn) => fn({ data, source, origin }));
        await Promise.resolve();
      });
    await message(
      {
        type: 'AXHUB_REFERENCE_COMMENTS_REQUEST',
        operation: 'read',
        requestId: '1',
        projectId: 'other',
        path: '/etc/passwd',
      },
      {},
      'null',
    );
    expect(fetcher).not.toHaveBeenCalled();
    await message({
      type: 'AXHUB_REFERENCE_COMMENTS_REQUEST',
      operation: 'read',
      requestId: '2',
      projectId: 'other',
      path: '/etc/passwd',
    });
    expect(fetcher.mock.calls[0][0]).toContain('projectId=p');
    expect(fetcher.mock.calls[0][0]).toContain(
      'path=.axhub%2Fmake%2Freferences%2Fa%2Ffiles%2Forders.html',
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'AXHUB_REFERENCE_COMMENTS_RESULT',
        requestId: '2',
        success: true,
      }),
      '*',
    );
    await message({
      type: 'AXHUB_PROTOTYPE_EDITOR_STATE',
      requestId: 'reference-enable',
      success: true,
    });
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((node) => node.children.includes('选择组件 / 批注'))!
        .props.onClick();
    });
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'AXHUB_REFERENCE_SELECT_COMPONENT' }, '*');
    await message({
      type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST',
      requestId: '3',
      action: { type: 'wake-agent' },
    });
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: '3', handled: true }),
      '*',
    );
    await message({
      type: 'AXHUB_REFERENCE_PAGE_READY',
      url: 'http://make.test/api/projects/other/reference-pages/a/files/details.html',
    });
    expect(renderer.root.findByType('iframe').props.src).toContain('orders.html');
    await message({
      type: 'AXHUB_REFERENCE_PAGE_READY',
      url: 'http://make.test/api/projects/p/reference-pages/a/files/details.html',
    });
    expect(renderer.root.findByType('iframe').props.src).toContain('details.html');
    await act(async () => renderer.unmount());
  });
  it('requires a parent-owned review confirmation before any reference request reaches AI', async () => {
    const listeners = new Set<(event: any) => void>();
    const postMessage = vi.fn();
    const child = { postMessage };
    const onGeneratePrototype = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', {
      location: { origin: 'http://make.test' },
      addEventListener: (_name: string, fn: any) => listeners.add(fn),
      removeEventListener: (_name: string, fn: any) => listeners.delete(fn),
    });
    let renderer!: ReactTestRenderer;
    const props = { projectId: 'p', page, onDocumentComponent: vi.fn(), onGeneratePrototype };
    await act(async () => {
      renderer = create(React.createElement(ReferencePageView, props), {
        createNodeMock: (element) => (element.type === 'iframe' ? { contentWindow: child } : null),
      });
    });
    const send = async (promptText = '把面板状态平铺') =>
      act(async () => {
        listeners.forEach((fn) =>
          fn({
            source: child,
            origin: 'null',
            data: {
              type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST',
              requestId: 'forged',
              action: { type: 'send-to-agent', promptText },
            },
          }),
        );
      });
    const button = (label: string) =>
      renderer.root.findAllByType('button').find((node) => node.children.includes(label))!;
    await send();
    expect(onGeneratePrototype).not.toHaveBeenCalled();
    expect(
      renderer.root.findAllByType('h2').some((node) => node.children.includes('AI 生成参考原型')),
    ).toBe(true);
    expect(renderer.root.findByProps({ 'aria-label': '即将交给 AI 的要求' }).props.value).toBe(
      '把面板状态平铺',
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'forged', handled: true }),
      '*',
    );
    await send('iframe 试图替换已经预览的要求');
    expect(renderer.root.findByProps({ 'aria-label': '即将交给 AI 的要求' }).props.value).toBe(
      '把面板状态平铺',
    );
    expect(onGeneratePrototype).not.toHaveBeenCalled();
    await act(async () => button('取消').props.onClick());
    expect(onGeneratePrototype).not.toHaveBeenCalled();
    expect(button('确认交给 AI')).toBeUndefined();
    await send('仅展开当前面板');
    await act(async () => button('确认交给 AI').props.onClick());
    expect(onGeneratePrototype).toHaveBeenCalledTimes(1);
    expect(onGeneratePrototype).toHaveBeenCalledWith(
      '仅展开当前面板',
      '.axhub/make/references/a/files/orders.html',
    );
    expect(button('确认交给 AI')).toBeUndefined();
    await send('x'.repeat(60001));
    expect(onGeneratePrototype).toHaveBeenCalledTimes(1);
    expect(button('确认交给 AI')).toBeUndefined();
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ handled: false }), '*');
    await send('改动旧页面');
    await act(async () =>
      renderer.update(
        React.createElement(ReferencePageView, { ...props, projectId: 'new-project' }),
      ),
    );
    expect(button('确认交给 AI')).toBeUndefined();
    expect(onGeneratePrototype).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('keeps failed requests reviewable and prevents duplicate execution while opening AI', async () => {
    const listeners = new Set<(event: any) => void>();
    const child = { postMessage: vi.fn() };
    let finish!: (handled: boolean) => void;
    const onGeneratePrototype = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('服务不可用'))
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal('window', {
      location: { origin: 'http://make.test' },
      addEventListener: (_name: string, fn: any) => listeners.add(fn),
      removeEventListener: (_name: string, fn: any) => listeners.delete(fn),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(ReferencePageView, {
          projectId: 'p',
          page,
          onDocumentComponent: vi.fn(),
          onGeneratePrototype,
        }),
        {
          createNodeMock: (element) =>
            element.type === 'iframe' ? { contentWindow: child } : null,
        },
      );
    });
    await act(async () => {
      listeners.forEach((fn) =>
        fn({
          source: child,
          origin: 'null',
          data: {
            type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST',
            requestId: 'request',
            action: { type: 'send-to-agent', promptText: '平铺组件状态' },
          },
        }),
      );
    });
    const button = (label: string) =>
      renderer.root.findAllByType('button').find((node) => node.children.includes(label))!;
    await act(async () => button('确认交给 AI').props.onClick());
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('未能交给 AI');
    await act(async () => button('确认交给 AI').props.onClick());
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('服务不可用');
    const confirm = button('确认交给 AI').props.onClick;
    await act(async () => {
      confirm();
      confirm();
    });
    expect(onGeneratePrototype).toHaveBeenCalledTimes(3);
    expect(button('正在交给 AI…').props.disabled).toBe(true);
    expect(button('取消').props.disabled).toBe(true);
    await act(async () => finish(true));
    expect(button('确认交给 AI')).toBeUndefined();
    await act(async () => renderer.unmount());
  });
});
