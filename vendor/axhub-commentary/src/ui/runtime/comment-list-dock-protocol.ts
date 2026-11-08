import type { CommentBatchAction, CommentListEntry, CommentListLoadState } from '../../core/editor/comment-batch';
export const COMMENT_LIST_DOCK_MESSAGE = 'AXHUB_COMMENT_LIST_DOCK';
export interface CommentListDockState {
  session: string;
  scope: string;
  open: boolean;
  entries: Array<Pick<CommentListEntry, 'id' | 'label' | 'note' | 'purpose' | 'state' | 'disabledReason'> & { locatable: boolean }>;
  loadState: CommentListLoadState;
  sendAvailable: boolean;
  generateAvailable: boolean;
  documentAvailable: boolean;
  selectedIds: string[];
  darkMode: boolean;
}
export interface CommentListDockAction {
  action: 'close' | 'unpin' | 'edit' | 'locate' | 'remove' | 'run' | 'retry' | 'select';
  ids?: string[];
  batchAction?: CommentBatchAction;
}
export function isCommentListDockState(value: unknown): value is CommentListDockState {
  if (!value || typeof value !== 'object') return false;
  const state = value as CommentListDockState;
  return typeof state.session === 'string' && Boolean(state.session) && typeof state.scope === 'string'
    && typeof state.open === 'boolean' && Array.isArray(state.entries) && state.entries.length <= 1000
    && state.entries.every(entry => typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.note === 'string' && (entry.disabledReason === undefined || typeof entry.disabledReason === 'string'))
    && Array.isArray(state.selectedIds) && state.selectedIds.length <= 1000 && state.selectedIds.every(id => typeof id === 'string')
    && ['loading', 'error', 'ready'].includes(state.loadState?.status);
}
