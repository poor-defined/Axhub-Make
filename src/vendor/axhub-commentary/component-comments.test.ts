import { describe, expect, it, vi } from 'vitest';
import * as comments from '../../../vendor/axhub-commentary/src/core/editor/component-comments';

const target = { elementKey: 'button', label: '提交', locator: { selectors: ['button'], fingerprint: 'button', path: [0] } };
function setup() {
  let scope = 'page-a';
  const records = new Map();
  const persist = vi.fn(async () => {});
  const store = comments.createComponentCommentStore({ records, getScope: () => scope, persist });
  return { store, records, persist, switchPage: () => { scope = 'page-b'; } };
}

describe('component comment records and drafts', () => {
  it('deletes exactly the selected records with one persistence write, including mixed purposes', async () => {
    const s = setup();
    s.store.updateDraft(target, 'modify-prototype', { note: 'one' }); const one = await s.store.saveDraft(target, 'modify-prototype');
    s.store.updateDraft(target, 'generate-prototype', { note: 'two' }); const two = await s.store.saveDraft(target, 'generate-prototype');
    s.store.updateDraft(target, 'modify-prototype', { note: 'keep' }); const keep = await s.store.saveDraft(target, 'modify-prototype');
    s.persist.mockClear();
    await s.store.removeMany([one.id, two.id, one.id]);
    expect(s.persist).toHaveBeenCalledOnce();
    expect(s.records.get(one.id).entry.deletedAt).toBeGreaterThan(0);
    expect(s.records.get(two.id).entry.deletedAt).toBeGreaterThan(0);
    expect(s.records.get(keep.id).entry.deletedAt).toBeUndefined();
  });
  it('rolls back the whole deletion after a persistence failure and retries without losing records', async () => {
    const s = setup();
    for (const note of ['one', 'two']) { s.store.updateDraft(target, 'modify-prototype', { note }); await s.store.saveDraft(target, 'modify-prototype'); }
    const ids = [...s.records.keys()]; s.persist.mockRejectedValueOnce(new Error('offline'));
    await expect(s.store.removeMany(ids)).rejects.toThrow('offline');
    expect(ids.every(id => !s.records.get(id).entry.deletedAt)).toBe(true);
    await s.store.removeMany(ids);
    expect(ids.every(id => s.records.get(id).entry.deletedAt > 0)).toBe(true);
  });
  it('refuses a batch containing an executing record before deleting any member', async () => {
    const s = setup();
    for (const note of ['idle', 'running']) { s.store.updateDraft(target, 'modify-prototype', { note }); await s.store.saveDraft(target, 'modify-prototype'); }
    const ids = [...s.records.keys()]; s.records.get(ids[1]).entry.state = 'editing'; s.persist.mockClear();
    await expect(s.store.removeMany(ids)).rejects.toThrow('执行');
    expect(s.persist).not.toHaveBeenCalled();
    expect(s.records.get(ids[0]).entry.deletedAt).toBeUndefined();
  });
  it('serializes deletion with saves and refuses duplicate deletion writes', async () => {
    const s = setup();
    s.store.updateDraft(target, 'modify-prototype', { note: 'saved' });
    const one = await s.store.saveDraft(target, 'modify-prototype');
    let finish!: () => void;
    s.persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const removing = s.store.removeMany([one.id]);
    await expect(s.store.removeMany([one.id])).rejects.toThrow('保存');
    s.store.updateDraft(target, 'modify-prototype', { note: 'next' });
    await expect(s.store.saveDraft(target, 'modify-prototype')).rejects.toThrow('删除');
    finish(); await removing;
    s.persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const saving = s.store.saveDraft(target, 'modify-prototype');
    await expect(s.store.removeMany([...s.records.keys()])).rejects.toThrow('保存');
    finish(); await saving;
  });
  it('does not roll a failed old-page deletion into the next page', async () => {
    const s = setup();
    s.store.updateDraft(target, 'modify-prototype', { note: 'old' });
    const one = await s.store.saveDraft(target, 'modify-prototype');
    let fail!: (error: Error) => void;
    s.persist.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const removing = s.store.removeMany([one.id]);
    s.switchPage(); s.records.clear();
    const newPageRecord = { entry: { id: one.id, comment: 'new page' }, images: [] };
    s.records.set(one.id, newPageRecord);
    fail(new Error('offline'));
    await expect(removing).rejects.toThrow('offline');
    expect(s.records.get(one.id)).toBe(newPageRecord);
  });
  it('clears legacy component annotations and their images while preserving purpose records and independent edits', () => {
    const document = { schemaVersion: 3 as const, kind: 'prototype-edit-comments' as const, resource: { id: 'home', targetPath: 'prototypes/home', filePath: '' }, comments: [
      { id: 'old', ...target, state: 'idle' as const, comment: 'legacy' },
      { id: 'new', ...target, state: 'idle' as const, comment: 'new', componentComment: true, purpose: 'modify-prototype' },
      { id: 'edit', ...target, state: 'idle' as const, comment: 'old note', textChange: { before: 'a', after: 'b' } },
      { id: 'voice', ...target, state: 'idle' as const, comment: 'voice', voiceCreateOperationId: 'operation' },
    ], images: [{ id: 'old-image', commentId: 'old' }, { id: 'new-image', commentId: 'new' }] };
    const result = comments.clearLegacyComponentComments(document);
    expect(result.changed).toBe(true);
    expect(result.document.comments.map(entry => entry.id)).toEqual(['new', 'edit', 'voice']);
    expect(result.document.comments.find(entry => entry.id === 'edit')).toMatchObject({ textChange: { after: 'b' } });
    expect(result.document.comments.find(entry => entry.id === 'edit')?.comment).toBeUndefined();
    expect(result.document.images.map(image => image.id)).toEqual(['new-image']);
    expect(comments.clearLegacyComponentComments(result.document).changed).toBe(false);
  });
  it('keeps document annotations, external review comments and unknown future purposes', () => {
    const document = { kind: 'prototype-edit-comments', comments: [
      { id: 'review', comment: 'review', externalComments: [{ id: 'external' }] },
      { id: 'author', comment: 'authored', author: 'visitor' },
      { id: 'future', purpose: 'future-purpose', comment: 'keep' },
      { id: 'text', elementKey: 'text-comment::123', comment: 'selected text' },
      { id: 'annotation', elementKey: 'annotation-panel:123', comment: 'document note' },
    ], images: [{ commentId: 'review' }, { commentId: 'future' }] };
    expect(comments.clearLegacyComponentComments(document)).toEqual({ document, changed: false });
    const doc = { ...document, kind: 'document-edit-comments', comments: [{ id: 'document', comment: 'untagged document note' }] };
    expect(comments.clearLegacyComponentComments(doc)).toEqual({ document: doc, changed: false });
  });
  it('updates only the requested record and ignores stale terminal execution events', () => {
    const record = { entry: { ...target, id: 'a', componentComment: true, purpose: 'modify-prototype', comment: 'note', state: 'idle' as const }, images: [] };
    expect(comments.transitionComponentComment(record, 'editing', { provider: 'acp', requestId: 'new', sessionId: 's' })).toBe(true);
    expect(record.entry.state).toBe('editing');
    expect(comments.transitionComponentComment(record, 'completed', { requestId: 'old' })).toBe(false);
    expect(record.entry.state).toBe('editing');
    expect(comments.transitionComponentComment(record, 'completed', { requestId: 'new' })).toBe(true);
    expect(record.entry.state).toBe('completed');
  });
  it('keeps all three purpose drafts and component/page drafts independent', () => {
    const { store, switchPage } = setup();
    store.updateDraft(target, 'modify-prototype', { note: '修改 A' });
    store.updateDraft(target, 'generate-prototype', { note: '生成 B', skillIds: ['skill'] });
    store.updateDraft(target, 'document-component', { note: '说明 C' });
    expect(store.getDraft(target, 'modify-prototype').note).toBe('修改 A');
    expect(store.getDraft(target, 'document-component').note).toBe('说明 C');
    expect(store.getDraft({ ...target, elementKey: 'other' }, 'modify-prototype').note).toBe('');
    switchPage();
    expect(store.getDraft(target, 'modify-prototype').note).toBe('');
  });
  it('saves two records of the same purpose on the same component without overwriting', async () => {
    const { store, records } = setup();
    store.updateDraft(target, 'modify-prototype', { note: '第一次' });
    const one = await store.saveDraft(target, 'modify-prototype');
    expect(store.getDraft(target, 'modify-prototype').note).toBe('');
    store.updateDraft(target, 'modify-prototype', { note: '第二次' });
    const two = await store.saveDraft(target, 'modify-prototype');
    expect(one.id).not.toBe(two.id);
    expect([...records.values()].map(record => record.entry.comment)).toEqual(['第一次', '第二次']);
  });
  it('preserves failed drafts and retries with the same record identity', async () => {
    const { store, records, persist } = setup();
    store.updateDraft(target, 'generate-prototype', { note: '保留', images: [{ id: 'image', data: 'data:image/png;base64,AA==', name: 'image.png', mimeType: 'image/png', size: 1, createdAt: 1 }] });
    const id = store.getDraft(target, 'generate-prototype').id;
    persist.mockRejectedValueOnce(new Error('offline'));
    await expect(store.saveDraft(target, 'generate-prototype')).rejects.toThrow('offline');
    expect(store.getDraft(target, 'generate-prototype').note).toBe('保留');
    expect(records.size).toBe(0);
    expect((await store.saveDraft(target, 'generate-prototype')).id).toBe(id);
    expect(records.size).toBe(1);
  });
  it('does not clear newer input or another purpose when a pending write completes', async () => {
    const { store, persist } = setup();
    let finish!: () => void;
    persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    store.updateDraft(target, 'modify-prototype', { note: '保存的版本' });
    const saving = store.saveDraft(target, 'modify-prototype');
    store.updateDraft(target, 'modify-prototype', { note: '后续输入' });
    store.updateDraft(target, 'document-component', { note: '独立说明' });
    finish(); await saving;
    expect(store.getDraft(target, 'modify-prototype').note).toBe('后续输入');
    expect(store.getDraft(target, 'document-component').note).toBe('独立说明');
    const newer = await store.saveDraft(target, 'modify-prototype');
    expect(newer.comment).toBe('后续输入');
  });
  it('edits only an explicitly opened record and deletes only its identity', async () => {
    const { store, records } = setup();
    store.updateDraft(target, 'modify-prototype', { note: '一' });
    const first = await store.saveDraft(target, 'modify-prototype');
    store.updateDraft(target, 'modify-prototype', { note: '二' });
    const second = await store.saveDraft(target, 'modify-prototype');
    store.edit(first.id);
    store.updateDraft(target, 'modify-prototype', { note: '编辑一' });
    expect((await store.saveDraft(target, 'modify-prototype')).id).toBe(first.id);
    expect(records.get(second.id).entry.comment).toBe('二');
    await store.remove(first.id);
    expect(records.get(first.id).entry.deletedAt).toBeGreaterThan(0);
    expect(records.get(second.id).entry.deletedAt).toBeUndefined();
  });
  it('saves blank notes as independent records and can clear an explicitly edited note', async () => {
    const { store, records } = setup();
    const first = await store.saveDraft(target, 'modify-prototype');
    store.updateDraft(target, 'modify-prototype', { note: '   \n ' });
    const second = await store.saveDraft(target, 'modify-prototype');
    expect(first.id).not.toBe(second.id); expect(records.size).toBe(2);
    expect(first.comment).toBe(''); expect(second.comment).toBe('');
    store.edit(first.id); store.updateDraft(target, 'modify-prototype', { note: 'later' }); await store.saveDraft(target, 'modify-prototype');
    store.edit(first.id); store.updateDraft(target, 'modify-prototype', { note: '' });
    expect((await store.saveDraft(target, 'modify-prototype')).id).toBe(first.id);
    expect(records.get(first.id).entry.comment).toBe(''); expect(records.size).toBe(2);
  });
  it('rejects concurrent saves without duplicate writes', async () => {
    const { store, persist } = setup();
    let finish!: () => void;
    persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    store.updateDraft(target, 'modify-prototype', { note: '保存' });
    const saving = store.saveDraft(target, 'modify-prototype');
    await expect(store.saveDraft(target, 'modify-prototype')).rejects.toThrow('暂存');
    finish(); await saving;
    expect(persist).toHaveBeenCalledOnce();
  });
  it('does not clear another record opened while an earlier record is saving', async () => {
    const { store, persist } = setup();
    store.updateDraft(target, 'modify-prototype', { note: 'A' }); const a = await store.saveDraft(target, 'modify-prototype');
    store.updateDraft(target, 'modify-prototype', { note: 'B' }); const b = await store.saveDraft(target, 'modify-prototype');
    store.edit(a.id);
    let finish!: () => void;
    persist.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const saving = store.saveDraft(target, 'modify-prototype');
    store.edit(b.id); finish(); await saving;
    expect(store.getDraft(target, 'modify-prototype')).toMatchObject({ id: b.id, note: 'B', editingCommentId: b.id });
  });
});
