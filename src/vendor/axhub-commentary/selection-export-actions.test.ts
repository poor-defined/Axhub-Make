import { describe, expect, it, vi } from 'vitest';
import { createEditorRuntimeState } from '../../../vendor/axhub-commentary/src/core/editor/state';
import { createSelectionExportActions } from '../../../vendor/axhub-commentary/src/core/editor/selection-export';
import { getDesignToolExportActionState } from '../../../vendor/axhub-commentary/src/ui/design-tool-export-action';
import type { exportSelectionToDesignTool } from '../../../vendor/axhub-commentary/src/design-tool-export';

function setup() {
  const state = createEditorRuntimeState();
  const exportSelection = vi.fn<typeof exportSelectionToDesignTool>(async () => {});
  const locked = new Set<Element>();
  const toast = vi.fn();
  const actions = createSelectionExportActions({ state, exportSelection, isLocked: (target) => locked.has(target), toast,
    prepareAxureExport: async () => true });
  const first = { isConnected: true } as Element, second = { isConnected: true } as Element;
  state.selectedElements = [first, second]; state.selectedElement = second;
  return { state, exportSelection, locked, toast, actions, first, second };
}

describe('selection export actions used by the editor lifecycle', () => {
  it('passes a stable full selection snapshot when exporting from any selected member', async () => {
    const { state, exportSelection, actions, first, second } = setup();
    await actions.onExportSelectionToDesignTool('axure', first);
    state.selectedElements.length = 0;
    expect(exportSelection.mock.calls[0][1]).toEqual([first, second]);
    expect(exportSelection.mock.calls[0][2]?.prepareAxureExport).toBeTypeOf('function');
  });
  it('blocks a locked or removed member instead of silently dropping it', async () => {
    const { actions, exportSelection, first, second, locked } = setup();
    locked.add(first);
    expect(actions.getExportSelectionToDesignToolBlockReason('axure', second)).toContain('AI');
    await actions.onExportSelectionToDesignTool('axure', second);
    expect(exportSelection).not.toHaveBeenCalled();
    locked.clear(); Object.assign(first, { isConnected: false });
    expect(actions.getExportSelectionToDesignToolBlockReason('axure', second)).toContain('失效');
  });
  it('does not recover a target from historical annotations or fall back to page export', async () => {
    const { state, actions, exportSelection } = setup();
    state.selectedElements = []; state.selectedElement = null;
    expect(actions.canExportSelectionToDesignTool('axure', null)).toBe(false);
    await actions.onExportSelectionToDesignTool('axure', null);
    expect(exportSelection).not.toHaveBeenCalled();
  });
  it('keeps unrelated card and Figma actions limited to their own target', async () => {
    const { actions, exportSelection, second } = setup();
    const unrelated = { isConnected: true } as Element;
    await actions.onExportSelectionToDesignTool('axure', unrelated);
    expect(exportSelection.mock.calls[0][1]).toEqual([unrelated]);
    await actions.onExportSelectionToDesignTool('figma', second);
    expect(exportSelection.mock.calls[1][1]).toBe(second);
  });
  it('labels Axure export with selection scope and container semantics', () => {
    const { actions, second } = setup();
    const result = getDesignToolExportActionState({ ...actions, tool: 'axure', currentTarget: second,
      uiMode: 'bubble-card', toolMinimized: false, selectedElementCount: 2 } as any);
    expect(result.visible).toBe(true);
    expect(result.title).toContain('2'); expect(result.title).toContain('选中'); expect(result.title).toContain('子元素');
  });
});
