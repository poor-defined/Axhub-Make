import type { EditorRuntimeState } from './state';

/** Return live members only; single-target integrations can still use selectedElement. */
export function getSelectedElements(state: EditorRuntimeState): Element[] {
  return Array.from(new Set([
    ...state.selectedElements,
    ...(state.selectedElement ? [state.selectedElement] : []),
  ])).filter((element) => element.isConnected);
}

/** Only fan out actions initiated on a member of the active selection. */
export function getSelectionActionTargets(
  state: EditorRuntimeState,
  element: Element | null,
  snapshot?: readonly Element[],
): Element[] {
  if (element && snapshot?.includes(element)) {
    return Array.from(new Set(snapshot)).filter((target) => target.isConnected);
  }
  if (!element?.isConnected) return [];
  const selected = snapshot
    ? Array.from(new Set(snapshot)).filter((target) => target.isConnected)
    : getSelectedElements(state);
  return selected.includes(element) ? selected : [element];
}
