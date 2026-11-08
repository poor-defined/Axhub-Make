import type { ElementLocator, PrototypeEditCommentEntry } from '../../web-editor-types';
import type { PromptImageAttachment } from './state';
export { clearLegacyComponentComments } from '../../comment-cleanup';

export const COMMENT_PURPOSES = [
  { id: 'generate-prototype', label: '生成新原型', action: 'generate', hint: '描述组件的不同状态，在独立原型中生成。' },
  { id: 'modify-prototype', label: '修改原型', action: 'send', hint: '描述要调整的内容，修改当前原型中的组件。' },
  { id: 'document-component', label: '引入说明', action: 'document', hint: '描述组件的说明要求，将截图与说明引入 PRD。' },
] as const;
export type ComponentCommentPurpose = typeof COMMENT_PURPOSES[number]['id'];
export function isComponentCommentPurpose(value: unknown): value is ComponentCommentPurpose {
  return COMMENT_PURPOSES.some(item => item.id === value);
}
export interface ComponentCommentTarget { elementKey: string; label: string; locator: ElementLocator }
export interface ComponentCommentRecord { entry: PrototypeEditCommentEntry; images: PromptImageAttachment[] }
export function transitionComponentComment(record: ComponentCommentRecord, state: PrototypeEditCommentEntry['state'], task: Partial<import('./state').ExternalEditingTaskRef> | null): boolean {
  if (record.entry.deletedAt) return false;
  if (state !== 'editing' && record.entry.requestId && task?.requestId !== record.entry.requestId) return false;
  record.entry = { ...record.entry, state, provider: task?.provider ?? record.entry.provider, sessionId: task?.sessionId ?? record.entry.sessionId,
    requestId: task?.requestId ?? record.entry.requestId, updatedAt: Date.now(), code: state === 'error' ? task?.code : null,
    message: state === 'error' ? task?.error || '执行失败，请重试' : state === 'completed' ? '修改完成' : state === 'editing' ? 'AI 编辑中' : null };
  return true;
}
export interface ComponentCommentDraft {
  token: string;
  id: string;
  note: string;
  skillIds: string[];
  images: PromptImageAttachment[];
  editingCommentId?: string;
  revision: number;
}
export type ComponentCommentStore = ReturnType<typeof createComponentCommentStore>;
export interface ComponentCommentApi {
  getScopeKey(): string;
  getDraft(element: Element, purpose: ComponentCommentPurpose): ComponentCommentDraft;
  updateDraft(element: Element, purpose: ComponentCommentPurpose, patch: Partial<Pick<ComponentCommentDraft, 'note' | 'skillIds' | 'images'>>): void;
  saveDraft(element: Element, purpose: ComponentCommentPurpose): Promise<PrototypeEditCommentEntry>;
  startNew(element: Element, purpose: ComponentCommentPurpose): void;
  edit(id: string): { element: Element; purpose: ComponentCommentPurpose };
  remove(id: string): Promise<void>;
  removeMany(ids: readonly string[]): Promise<void>;
  run(action: 'send' | 'generate' | 'document', ids: readonly string[]): Promise<void>;
}
const newId = () => globalThis.crypto?.randomUUID?.() ?? `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyDraft = (): ComponentCommentDraft => ({ token: newId(), id: newId(), note: '', skillIds: [], images: [], revision: 0 });
const cloneDraft = (draft: ComponentCommentDraft): ComponentCommentDraft => ({ ...draft, skillIds: draft.skillIds.slice(), images: draft.images.map(image => ({ ...image })) });

/** Records have independent identities; drafts are scoped to page, component and purpose. */
export function createComponentCommentStore(options: {
  records: Map<string, ComponentCommentRecord>;
  getScope: () => string;
  getPageScope?: () => string;
  persist: () => Promise<void>;
  onRollback?: () => void;
}) {
  const drafts = new Map<string, ComponentCommentDraft>();
  const saving = new Set<string>();
  let deleting = false;
  const keyFor = (target: ComponentCommentTarget, purpose: ComponentCommentPurpose) => JSON.stringify([options.getScope(), target.elementKey, purpose]);
  function getDraft(target: ComponentCommentTarget, purpose: ComponentCommentPurpose): ComponentCommentDraft {
    const key = keyFor(target, purpose);
    if (!drafts.has(key)) drafts.set(key, emptyDraft());
    return cloneDraft(drafts.get(key)!);
  }
  function updateDraft(target: ComponentCommentTarget, purpose: ComponentCommentPurpose, patch: Partial<Pick<ComponentCommentDraft, 'note' | 'skillIds' | 'images'>>): void {
    const current = getDraft(target, purpose);
    drafts.set(keyFor(target, purpose), cloneDraft({ ...current, ...patch, revision: current.revision + 1 }));
  }
  async function saveDraft(target: ComponentCommentTarget, purpose: ComponentCommentPurpose): Promise<PrototypeEditCommentEntry> {
    const key = keyFor(target, purpose);
    if (saving.has(key) || deleting) throw new Error('正在暂存或删除批注，请稍候');
    const draft = getDraft(target, purpose);
    if (draft.note.length > 8000) throw new Error('批注内容过长，请缩短后重试');
    const previous = options.records.get(draft.id);
    if (previous?.entry.deletedAt) throw new Error('此批注已删除，请新增批注');
    const scope = options.getScope();
    const now = Date.now();
    const entry: PrototypeEditCommentEntry = {
      ...previous?.entry, ...target, id: draft.id, componentComment: true, purpose,
      ...(options.getPageScope ? { pageScope: options.getPageScope() } : {}),
      state: 'idle', provider: null, requestId: null, sessionId: null, message: null, code: null,
      comment: draft.note.trim(), skillIds: draft.skillIds.slice(), createdAt: previous?.entry.createdAt ?? now, updatedAt: now,
    };
    const record = { entry, images: draft.images.map(image => ({ ...image })) };
    saving.add(key); options.records.set(entry.id, record);
    try {
      await options.persist();
      if (drafts.get(key)?.token !== draft.token) return { ...entry };
      if (drafts.get(key)?.revision === draft.revision) drafts.set(key, emptyDraft());
      else {
        // A new note typed during saving is the next annotation, not an implicit edit.
        const newer = drafts.get(key)!;
        drafts.set(key, { ...newer, token: newId(), id: newId(), editingCommentId: undefined });
      }
      return { ...entry };
    } catch (error) {
      if (options.getScope() === scope && options.records.get(entry.id) === record) {
        if (previous) options.records.set(entry.id, previous); else options.records.delete(entry.id);
        options.onRollback?.();
      }
      throw error;
    } finally { saving.delete(key); }
  }
  function edit(id: string): ComponentCommentPurpose {
    const record = options.records.get(id);
    if (!record || record.entry.deletedAt || !isComponentCommentPurpose(record.entry.purpose)) throw new Error('此批注不存在或用途暂不支持');
    if (record.entry.state === 'editing') throw new Error('批注正在执行，请稍候');
    const target = { elementKey: record.entry.elementKey!, label: record.entry.label || '', locator: record.entry.locator };
    drafts.set(keyFor(target, record.entry.purpose), {
      token: newId(), id, note: record.entry.comment || '', skillIds: record.entry.skillIds?.slice() ?? [],
      images: record.images.map(image => ({ ...image })), editingCommentId: id, revision: 0,
    });
    return record.entry.purpose;
  }
  function startNew(target: ComponentCommentTarget, purpose: ComponentCommentPurpose): void {
    drafts.set(keyFor(target, purpose), emptyDraft());
  }
  async function remove(id: string): Promise<void> {
    if (!options.records.has(id) || options.records.get(id)!.entry.deletedAt) return;
    await removeMany([id]);
  }
  async function removeMany(ids: readonly string[]): Promise<void> {
    if (deleting || saving.size) throw new Error('正在保存批注，请稍候');
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const scope = options.getScope();
    // Validate the entire batch before mutating any record.
    const changes = unique.map(id => {
      const previous = options.records.get(id);
      if (!previous || previous.entry.deletedAt) throw new Error('批注已变更，请重新选择');
      if (previous.entry.state === 'editing') throw new Error('批注正在执行，请稍候');
      return { id, previous, tombstone: { ...previous, entry: { ...previous.entry, deletedAt: Date.now() } } };
    });
    deleting = true;
    for (const change of changes) options.records.set(change.id, change.tombstone);
    try { await options.persist(); }
    catch (error) {
      if (options.getScope() === scope) for (const change of changes) {
        if (options.records.get(change.id) === change.tombstone) options.records.set(change.id, change.previous);
      }
      if (options.getScope() === scope) options.onRollback?.();
      throw error;
    } finally { deleting = false; }
  }
  return { getDraft, updateDraft, saveDraft, edit, startNew, remove, removeMany };
}
