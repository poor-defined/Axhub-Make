import type { WebEditorDesignAdjustmentTool } from './core/editor/ui-settings';
import { assertMergeableSelection, getAxureSelectionRoots, mergeAxureSelectionPayloads, readSelectionRect } from './axure-selection';

type ExportCoreModule = {
  htmlToAxure: (selector?: string | HTMLElement, options?: unknown) => Promise<unknown>;
  htmlToFigma: (selector?: string | HTMLElement, options?: unknown) => Promise<unknown>;
  safeCopyToFigmaWithKiwi: (payload: { layers: unknown[] }) => Promise<{
    skipped: boolean;
    reason?: string;
  }>;
};

let exportCoreLoader = async (): Promise<ExportCoreModule> => import('axhub-export-core');

export function __setExportCoreLoaderForTests(
  loader: (() => Promise<ExportCoreModule>) | null,
): void {
  exportCoreLoader = loader ?? (async () => import('axhub-export-core'));
}

export function isExportableDesignElement(element: Element | null): element is HTMLElement | SVGElement {
  return (element instanceof HTMLElement || (typeof SVGElement !== 'undefined' && element instanceof SVGElement)) && element.isConnected;
}

export function getSvgSelectionBlockReason(element: Element): string | undefined {
  return typeof SVGElement !== 'undefined' && element instanceof SVGElement && element.ownerSVGElement
    ? '暂不支持单独导出 SVG 内部节点，请选择 SVG 容器后重试。' : undefined;
}

export function getDesignToolExportBlockReason(element: Element | null): string | undefined {
  if (!isExportableDesignElement(element)) {
    return '当前没有可导出的元素';
  }
  return getSvgSelectionBlockReason(element);
}

function getSelectionExportName(element: Element): string {
  for (const value of [
    element.getAttribute('data-axhub-display-name'),
    element.getAttribute('aria-label'),
    element.getAttribute('data-page-id'),
    element.getAttribute('data-component-id'),
    element.id,
    element.getAttribute('data-testid'),
  ]) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }

  return element.tagName?.toUpperCase?.() || 'FRAME';
}

async function copyAxurePayload(payload: unknown): Promise<void> {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('当前环境不支持文本复制，请检查浏览器剪贴板权限后重试。');
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
  } catch (error) {
    throw normalizeClipboardWriteError(error);
  }
}

function isClipboardPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { name, message } = error as { name?: string; message?: string };
  const normalizedName = String(name || '').trim();
  const normalizedMessage = String(message || '').trim();

  return normalizedName === 'NotAllowedError'
    || /Document is not focused/i.test(normalizedMessage)
    || /permission/i.test(normalizedMessage)
    || /denied/i.test(normalizedMessage)
    || /not allowed/i.test(normalizedMessage);
}

function normalizeClipboardWriteError(error: unknown): Error {
  if (isClipboardPermissionError(error)) {
    return new Error('当前页面暂时无法写入剪贴板，请先切回当前页面后重试。');
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('剪贴板写入失败，请稍后重试。');
}

export async function exportSelectionToDesignTool(
  tool: WebEditorDesignAdjustmentTool,
  element: Element | readonly Element[],
  options?: { prepareAxureExport?: (payload: unknown) => Promise<boolean> },
): Promise<void> {
  const targets = Array.isArray(element) ? [...element] : [element as Element];
  if (!targets.length) throw new Error('当前没有可导出的元素。');
  if (targets.some((target) => !isExportableDesignElement(target))) {
    throw new Error('选中元素已失效，请重新选择后再导出。');
  }
  if (tool !== 'axure' && targets.length > 1) throw new Error('当前设计工具仅支持单元素导出。');
  if (tool === 'figma' || tool === 'pencil') {
    const { htmlToFigma, safeCopyToFigmaWithKiwi } = await exportCoreLoader();
    const layers = await htmlToFigma(targets[0] as HTMLElement, {
      rootName: getSelectionExportName(targets[0]), enableAutoLayout: true,
    });
    const result = await safeCopyToFigmaWithKiwi({ layers: Array.isArray(layers) ? layers : [] })
      .catch((error) => { throw normalizeClipboardWriteError(error); });
    if (result.skipped) {
      if (result.reason === 'clipboard_unavailable') throw new Error('当前环境不支持剪贴板写入，请检查浏览器权限后重试。');
      throw new Error(`导出到 ${tool} 失败。`);
    }
    return;
  }
  if (targets.some((target) => target.ownerDocument !== targets[0].ownerDocument)) throw new Error('请选择同一页面中的元素。');
  const roots = getAxureSelectionRoots(targets);
  const svgReason = roots.map(getSvgSelectionBlockReason).find(Boolean);
  if (svgReason) throw new Error(svgReason);
  assertMergeableSelection(roots);
  const bounds = (target: Element) => {
    const { left, top, width, height } = target.getBoundingClientRect();
    return JSON.stringify([left, top, width, height]);
  };
  const snapshots = roots.map((target) => {
    const descendants = Array.from(target.querySelectorAll?.('*') || []);
    return { target, rect: readSelectionRect(target), text: target.textContent, descendants,
      descendantBounds: descendants.map(bounds) };
  });
  const assertUnchanged = () => {
    for (const { target, rect, text, descendants, descendantBounds } of snapshots) {
      const currentDescendants = Array.from(target.querySelectorAll?.('*') || []);
      if (!target.isConnected || target.textContent !== text || JSON.stringify(readSelectionRect(target)) !== JSON.stringify(rect)
        || currentDescendants.length !== descendants.length || descendants.some((child, index) =>
          child !== currentDescendants[index] || !child.isConnected || bounds(child) !== descendantBounds[index])) {
        throw new Error('导出期间选区发生变化，请重新选择后重试。');
      }
    }
  };
  const { htmlToAxure } = await exportCoreLoader();
  assertUnchanged();
  const captures = [];
  for (const { target, rect } of snapshots) {
    assertUnchanged();
    const payload = await htmlToAxure(target as HTMLElement, {
      rootName: getSelectionExportName(target), preserveHierarchy: true, preserveSvgIcons: true,
      useCustomSize: true, targetWidth: rect.width, targetHeight: rect.height,
    });
    const captured = payload as { scene?: { items?: Array<{ scene?: { items?: unknown[] } }> } };
    if (!captured?.scene?.items?.some((board) => board.scene?.items?.length)) {
      throw new Error('选中元素没有可导出的可见内容，请重新选择。');
    }
    captures.push({ payload, rect });
  }
  assertUnchanged();
  const payload = captures.length === 1 ? captures[0].payload : mergeAxureSelectionPayloads(captures);
  if (options?.prepareAxureExport) {
    if (!await options.prepareAxureExport(payload)) {
      throw new Error('未能打开 Axure 整理预览，请刷新 Make 页面后重试。');
    }
    return;
  }
  await copyAxurePayload(payload);
}
