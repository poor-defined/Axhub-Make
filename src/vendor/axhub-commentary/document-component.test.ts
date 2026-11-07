import { describe, expect, it, vi } from 'vitest';
import type { CommentaryDocumentComponentCapture } from '../../../vendor/axhub-commentary/src/web-editor-types';
import { createDocumentComponentAction } from '../../../vendor/axhub-commentary/src/core/editor/document-component';

describe('component documentation action', () => {
  it('captures pages without a document title using a nonempty source label', async () => {
    const deliver = vi.fn<(capture: CommentaryDocumentComponentCapture) => Promise<boolean>>(async () => true);
    const action = createDocumentComponentAction({
      getSelectedElements: () => [element], deliver, toast: vi.fn(),
      getSource: () => ({title:'',url:'https://example.test/page'}),
      capture: vi.fn(async () => ({data:'data:image/png;base64,cGlj',name:'component.png',width:10,height:10})),
    });
    await action(element, '');
    expect(deliver.mock.calls[0][0].source.title).toBe('当前页面');
  });
  const element = {
    isConnected: true,
    tagName: 'SECTION',
    textContent: '账户余额',
    getAttribute: (name: string) => (name === 'aria-label' ? '资产面板' : null),
  } as unknown as Element;
  function setup(selection: Element[] = [element]) {
    const capture = vi.fn(async () => ({
      data: 'data:image/png;base64,cGlj',
      name: 'component.png',
      width: 100,
      height: 50,
    }));
    const deliver = vi.fn<(capture: CommentaryDocumentComponentCapture) => Promise<boolean>>(
      async () => true,
    );
    const toast = vi.fn();
    const onAccepted = vi.fn();
    const action = createDocumentComponentAction({
      getSelectedElements: () => selection,
      capture,
      deliver,
      toast,
      onAccepted,
      getSource: () => ({ title: '交易页面', url: 'https://example.test/page' }),
    });
    return { action, capture, deliver, toast, onAccepted };
  }
  it('captures exactly one selected component and delivers the current unsaved note including empty input', async () => {
    const { action, capture, deliver } = setup();
    await action(element, '');
    expect(capture).toHaveBeenCalledWith(element, 'component');
    expect(deliver).toHaveBeenCalledWith({
      imageDataUrl: 'data:image/png;base64,cGlj',
      note: '',
      component: { name: '资产面板', text: '账户余额' },
      source: { title: '交易页面', url: 'https://example.test/page' },
    });
  });
  it('preserves a stable source selector for documentation traceability', async () => {
    const deliver = vi.fn<(capture: CommentaryDocumentComponentCapture) => Promise<boolean>>(
      async () => true,
    );
    const action = createDocumentComponentAction({
      getSelectedElements: () => [element],
      getSelector: () => '#asset-panel',
      deliver,
      toast: vi.fn(),
      capture: vi.fn(async () => ({
        data: 'data:image/png;base64,cGlj',
        name: 'component.png',
        width: 100,
        height: 50,
      })),
      getSource: () => ({ title: '页面', url: 'https://example.test' }),
    });
    await action(element, '');
    expect(deliver.mock.calls[0][0].component.selector).toBe('#asset-panel');
  });
  it('cleans up selection chrome only after the parent accepts the capture', async () => {
    const { action, deliver, onAccepted } = setup();
    deliver.mockResolvedValueOnce(false);
    await action(element, '说明');
    expect(onAccepted).not.toHaveBeenCalled();
    await action(element, '说明');
    expect(onAccepted).toHaveBeenCalledWith(element);
  });
  it('blocks multi-selection and does not silently choose one member', async () => {
    const { action, capture, toast } = setup([element, element]);
    await action(element, '说明');
    expect(capture).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });
  it('reports screenshot failure without invoking the host', async () => {
    const { action, capture, deliver, toast } = setup();
    capture.mockRejectedValueOnce(new Error('截图失败'));
    await action(element, '说明');
    expect(deliver).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('error', '截图失败');
  });
  it('prevents repeated clicks while a screenshot is being captured', async () => {
    const { action, capture, deliver } = setup();
    let resolve!: (value: any) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = action(element, '第一条');
    await action(element, '第二条');
    resolve({ data: 'data:image/png;base64,cGlj' });
    await first;
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
