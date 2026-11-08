import { captureElementScreenshot, type EditorElementScreenshot } from './screenshot';
import type { CommentaryDocumentComponentCapture } from '../../web-editor-types';
import type { CommentaryComponentStatesRequest } from '../../web-editor-types';

/** A documentation capture uses the selected DOM node itself, with no context frame or selection outline. */
export function createDocumentComponentAction(options: {
  getSelectedElements: () => Element[];
  deliver: (capture: CommentaryDocumentComponentCapture) => Promise<boolean>;
  toast: (tone: 'error' | 'warning', message: string) => void;
  getSelector?: (element: Element) => string | undefined;
  onAccepted?: (element: Element) => void;
  getSource?: () => { title: string; url: string };
  capture?: (element: Element, name: string) => Promise<EditorElementScreenshot>;
  purpose?: 'documentation' | 'component-states';
}) {
  let capturing = false;
  return async (element: Element, note: string): Promise<void> => {
    if (capturing) return;
    const selected = options.getSelectedElements();
    if (selected.length !== 1 || selected[0] !== element || !element.isConnected) {
      options.toast('warning', options.purpose === 'component-states' ? '请选择一个组件或容器后生成状态原型。' : '请选择一个组件或容器后引入说明。');
      return;
    }
    capturing = true;
    try {
      const screenshot = await (options.capture ?? captureElementScreenshot)(element, 'component');
      if (!element.isConnected) throw new Error('组件已失效，请重新选择后截图。');
      const name =
        element.getAttribute('aria-label') ||
        element.getAttribute('data-label') ||
        element.getAttribute('title') ||
        element.tagName.toLowerCase();
      const selector = options.getSelector?.(element);
      const source = options.getSource?.() ?? { title: document.title, url: window.location.href };
      const handled = await options.deliver({
        imageDataUrl: screenshot.data,
        note,
        component: {
          name: name.slice(0, 160),
          text: (element.textContent || '').trim().slice(0, 12_000),
          ...(selector ? { selector } : {}),
        },
        source: { ...source, title: source.title.trim() || '当前页面' },
      });
      if (!handled) throw new Error(options.purpose === 'component-states' ? '未能打开状态生成窗口，请处理当前任务或返回项目页面重试。' : '未能打开引入说明，请返回项目页面重试。');
      options.onAccepted?.(element);
    } catch (error) {
      options.toast('error', error instanceof Error ? error.message : '组件截图失败，请重试。');
    } finally {
      capturing = false;
    }
  };
}

export function createComponentStatesAction(options: Omit<Parameters<typeof createDocumentComponentAction>[0], 'deliver'> & {
  deliver: (request: CommentaryComponentStatesRequest) => Promise<boolean>;
}) {
  let busy = false;
  return async (element: Element, note: string): Promise<void> => {
    if (busy) return;
    if (!note.trim()) { options.toast('warning', '请填写需要生成的状态及变化要求'); return; }
    busy = true;
    try {
      const sourceHtml = (element.outerHTML || '').slice(0, 60000);
      await createDocumentComponentAction({ ...options, purpose: 'component-states', deliver: capture => options.deliver({
        capture, title: `${capture.component.name.replace(/\s*\[prd:[^\]]+\]/gu, '').slice(0, 80)} 状态说明`, layout: 'overview', sourceHtml,
      }) })(element, note);
    } finally { busy = false; }
  };
}
