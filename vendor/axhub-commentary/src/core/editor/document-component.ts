import { captureElementScreenshot, type EditorElementScreenshot } from './screenshot';
import type { CommentaryDocumentComponentCapture } from '../../web-editor-types';

/** A documentation capture uses the selected DOM node itself, with no context frame or selection outline. */
export function createDocumentComponentAction(options: {
  getSelectedElements: () => Element[];
  deliver: (capture: CommentaryDocumentComponentCapture) => Promise<boolean>;
  toast: (tone: 'error' | 'warning', message: string) => void;
  getSelector?: (element: Element) => string | undefined;
  onAccepted?: (element: Element) => void;
  getSource?: () => { title: string; url: string };
  capture?: (element: Element, name: string) => Promise<EditorElementScreenshot>;
}) {
  let capturing = false;
  return async (element: Element, note: string): Promise<void> => {
    if (capturing) return;
    const selected = options.getSelectedElements();
    if (selected.length !== 1 || selected[0] !== element || !element.isConnected) {
      options.toast('warning', '请选择一个组件或容器后引入说明。');
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
      if (!handled) throw new Error('未能打开引入说明，请返回项目页面重试。');
      options.onAccepted?.(element);
    } catch (error) {
      options.toast('error', error instanceof Error ? error.message : '组件截图失败，请重试。');
    } finally {
      capturing = false;
    }
  };
}
