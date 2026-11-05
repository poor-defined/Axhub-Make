import type { CommentEntryMode } from './selection-ui-mode';
import type { WebEditorDesignAdjustmentTool } from '../core/editor/ui-settings';

export type ExportSelectionToDesignToolHandler = (
  tool: WebEditorDesignAdjustmentTool,
  element: Element,
) => void | Promise<void>;

export function getDesignToolExportLabel(tool: WebEditorDesignAdjustmentTool): string {
  return `导出到 ${tool}`;
}

export function getDesignToolExportActionState(options: {
  selectedElementCount?: number;
  tool: WebEditorDesignAdjustmentTool | null;
  currentTarget: Element | null;
  uiMode: CommentEntryMode;
  toolMinimized: boolean;
  onExportSelectionToDesignTool?: ExportSelectionToDesignToolHandler | undefined;
  canExportSelectionToDesignTool?: (
    tool: WebEditorDesignAdjustmentTool,
    element: Element | null,
  ) => boolean;
  getExportSelectionToDesignToolBlockReason?: (
    tool: WebEditorDesignAdjustmentTool,
    element: Element | null,
  ) => string | undefined;
}): {
  visible: boolean;
  disabled: boolean;
  title: string;
  label: string;
} {
  const { tool } = options;
  if (!tool) {
    return {
      visible: false,
      disabled: true,
      title: '',
      label: '',
    };
  }

  const label = tool === 'axure'
    ? `仅导出选中元素到 Axure（${options.selectedElementCount ?? 1} 个；容器包含子元素）`
    : getDesignToolExportLabel(tool);
  const hostCanExport = options.canExportSelectionToDesignTool?.(tool, options.currentTarget) ?? true;
  if (!options.onExportSelectionToDesignTool || hostCanExport === false) {
    return {
      visible: false,
      disabled: true,
      title: label,
      label,
    };
  }

  const blockReason = options.getExportSelectionToDesignToolBlockReason?.(tool, options.currentTarget);
  return {
    visible: options.uiMode === 'bubble-card' && !options.toolMinimized,
    disabled: !options.currentTarget || Boolean(blockReason),
    title: blockReason ?? label,
    label,
  };
}

export function triggerDesignToolExportAction(options: {
  tool: WebEditorDesignAdjustmentTool | null;
  currentTarget: Element | null;
  onExportSelectionToDesignTool?: ExportSelectionToDesignToolHandler | undefined;
}): boolean {
  const { tool, currentTarget, onExportSelectionToDesignTool } = options;
  if (!tool || !currentTarget || !currentTarget.isConnected || !onExportSelectionToDesignTool) {
    return false;
  }

  void onExportSelectionToDesignTool(tool, currentTarget);
  return true;
}
