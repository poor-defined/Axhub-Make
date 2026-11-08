import { exportSelectionToDesignTool, getSvgSelectionBlockReason } from '../../design-tool-export';
import type { WebEditorDesignAdjustmentTool } from './ui-settings';
import type { EditorRuntimeState } from './state';

/** Export actions deliberately use current selection, never annotation history. */
export function createSelectionExportActions(options: {
  state: EditorRuntimeState;
  isLocked: (element: Element) => boolean;
  toast: (tone: 'success' | 'error', message: string) => void;
  prepareAxureExport?: (payload: unknown) => Promise<boolean>;
  exportSelection?: typeof exportSelectionToDesignTool;
}) {
  let busy = false;
  function targets(tool: WebEditorDesignAdjustmentTool, element?: Element | null): Element[] {
    const target = element ?? options.state.selectedElement;
    if (!target) return [];
    const selection = [...new Set([...options.state.selectedElements, ...(options.state.selectedElement ? [options.state.selectedElement] : [])])];
    return tool === 'axure' && selection.includes(target) ? selection : [target];
  }
  function getBlockReason(tool: WebEditorDesignAdjustmentTool, element?: Element | null): string | undefined {
    if (busy) return '正在采集选中元素，请稍候';
    const selection = targets(tool, element);
    if (!selection.length) return '当前没有可导出的元素';
    if (selection.some((target) => !target.isConnected)) return '选中元素已失效，请重新选择后再导出';
    const svgReason = selection.map((target) => getSvgSelectionBlockReason(target)
      && !selection.some((parent) => parent !== target && parent.contains(target)) ? getSvgSelectionBlockReason(target) : undefined).find(Boolean);
    if (svgReason) return svgReason;
    if (selection.some(options.isLocked)) return '选中元素正在由 AI 更新';
    return undefined;
  }
  return {
    canExportSelectionToDesignTool: (tool: WebEditorDesignAdjustmentTool, element?: Element | null) => targets(tool, element).length > 0,
    getExportSelectionToDesignToolBlockReason: getBlockReason,
    onExportSelectionToDesignTool: async (tool: WebEditorDesignAdjustmentTool, element?: Element | null) => {
      const reason = getBlockReason(tool, element);
      if (reason) { options.toast('error', reason); return; }
      const snapshot = targets(tool, element);
      const prepare = tool === 'axure' ? options.prepareAxureExport : undefined;
      busy = true;
      try {
        await (options.exportSelection ?? exportSelectionToDesignTool)(tool, tool === 'axure' ? snapshot : snapshot[0],
          prepare ? { prepareAxureExport: prepare } : undefined);
        options.toast('success', prepare ? `已打开选中 ${snapshot.length} 个元素的 Axure 整理预览，请确认后复制` : `已导出到 ${tool}`);
      } catch (error) {
        options.toast('error', error instanceof Error ? error.message : String(error));
      } finally { busy = false; }
    },
  };
}
