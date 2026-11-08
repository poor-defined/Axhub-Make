import { afterEach, expect, it, vi } from 'vitest';
import { createPersistenceService } from '../../../vendor/axhub-commentary/src/core/editor/persistence';
import { createEditorRuntimeState } from '../../../vendor/axhub-commentary/src/core/editor/state';
import type { PrototypeEditCommentsDocument } from '../../../vendor/axhub-commentary/src/web-editor-types';
import { createComponentCommentStore } from '../../../vendor/axhub-commentary/src/core/editor/component-comments';

afterEach(() => vi.unstubAllGlobals());
const scope = { targetPath: 'prototypes/home', storageScope: 'purpose-test', prototypeId: 'home', filePath: 'src/prototypes/home/index.tsx', resource: null };
const locator = { selectors: ['button'], fingerprint: 'button', path: [0] };
it('persists an explicit empty instruction when an existing record is cleared and restores that same record', async () => {
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const state = createEditorRuntimeState(); let saved!: PrototypeEditCommentsDocument;
  const adapter = { read: async () => saved, write: async (_: unknown, document: PrototypeEditCommentsDocument) => { saved = document; } };
  const changes = { syncEditMetaWithTransactions: vi.fn() } as never;
  const persistence = createPersistenceService({ state, changes, getPersistenceScope: () => scope, persistenceAdapter: adapter });
  const store = createComponentCommentStore({ records: state.componentCommentsById, getScope: () => 'page', persist: async () => { persistence.flushPendingWrite(); await persistence.waitForPendingWrites(); } });
  const target = { elementKey: 'button', label: '提交', locator };
  store.updateDraft(target, 'modify-prototype', { note: 'old instruction' }); const first = await store.saveDraft(target, 'modify-prototype');
  store.edit(first.id); store.updateDraft(target, 'modify-prototype', { note: '' }); await store.saveDraft(target, 'modify-prototype');
  expect(saved.comments).toHaveLength(1); expect(saved.comments[0].comment).toBe('');
  const restored = createEditorRuntimeState();
  await createPersistenceService({ state: restored, changes, getPersistenceScope: () => scope, persistenceAdapter: adapter }).restoreCachedChanges();
  expect(restored.componentCommentsById.get(first.id)?.entry.comment).toBe('');
});
it('does not retain failed deletion tombstones in the local cache or in a subsequent unrelated save', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  const state = createEditorRuntimeState();
  for (const id of ['one', 'two']) state.componentCommentsById.set(id, { entry: { id, elementKey: 'button', locator, componentComment: true, purpose: 'modify-prototype', comment: id, state: 'idle' }, images: [] });
  let offline = false; let saved!: PrototypeEditCommentsDocument;
  const service = createPersistenceService({ state, changes: { syncEditMetaWithTransactions: vi.fn() } as never, getPersistenceScope: () => scope,
    persistenceAdapter: { read: async () => saved, write: async (_, doc) => { if (offline) throw Error('offline'); saved = doc; } } });
  const store = createComponentCommentStore({ records: state.componentCommentsById, getScope: () => 'page', onRollback: () => service.refreshLocalSnapshot?.(),
    persist: async () => { service.flushPendingWrite(); await service.waitForPendingWrites(); if (service.getSaveStatus() === 'unsaved') throw Error('offline'); } });
  service.flushPendingWrite(); await service.waitForPendingWrites();
  offline = true;
  await expect(store.removeMany(['one'])).rejects.toThrow('offline');
  expect(state.componentCommentsById.get('one')?.entry.deletedAt).toBeUndefined();
  const cached = JSON.parse(storage.get('web-editor-v2-cache:prototypes/home')!);
  expect(cached.entries.find((entry: { commentId: string }) => entry.commentId === 'one').deletedAt).toBeUndefined();
  offline = false;
  state.componentCommentsById.get('two')!.entry.comment = 'unrelated change';
  service.flushPendingWrite(); await service.waitForPendingWrites();
  expect(saved.comments.find(entry => entry.id === 'one')?.deletedAt).toBeUndefined();
  expect(saved.comments.find(entry => entry.id === 'two')?.comment).toBe('unrelated change');
});
it('clears legacy local-cache annotations on load and retains the new record and its images', async () => {
  const storage = new Map<string, string>();
  const old = { commentId: 'old', elementKey: 'button', locator, note: 'legacy' };
  const image = { id: 'new-image', name: 'new.png', data: 'data:image/png;base64,AA==', mimeType: 'image/png', size: 1, createdAt: 1 };
  storage.set('web-editor-v2-cache:prototypes/home', JSON.stringify({ version: 6, path: 'prototypes/home', entries: [old,
    { ...old, commentId: 'new', componentComment: true, purpose: 'modify-prototype', note: 'new', componentImages: [image] },
  ] }));
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  const state = createEditorRuntimeState();
  const service = createPersistenceService({ state, purgeLegacyComponentComments: true, changes: { syncEditMetaWithTransactions: vi.fn() } as never, getPersistenceScope: () => scope });
  await service.restoreCachedChanges();
  expect([...state.componentCommentsById.keys()]).toEqual(['new']);
  expect(state.componentCommentsById.get('new')?.images[0].id).toBe('new-image');
  const cached = JSON.parse(storage.get('web-editor-v2-cache:prototypes/home')!);
  expect(cached.entries.map((entry: { commentId: string }) => entry.commentId)).toEqual(['new']);
});
it('round trips multiple purpose records on one component including attachments, blank notes, skills and unknown purposes', async () => {
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const records = ['modify-prototype', 'modify-prototype', 'generate-prototype', 'future-purpose'].map((purpose, index) => ({
    entry: { id: `comment-${index}`, elementKey: 'button', label: '提交', locator, componentComment: true, purpose, comment: index < 3 ? '' : `note ${index}`, skillIds: index === 1 ? ['layout'] : [], state: 'idle' as const, createdAt: 100 + index },
    images: index === 0 ? [{ id: 'img', name: 'one.png', data: 'data:image/png;base64,AA==', mimeType: 'image/png', size: 1, createdAt: 100 }] : [],
  }));
  const state = createEditorRuntimeState();
  // The independent record collection must be part of the real runtime state.
  expect(state.componentCommentsById).toBeInstanceOf(Map);
  records.forEach(record => state.componentCommentsById.set(record.entry.id, record));
  let saved!: PrototypeEditCommentsDocument;
  const adapter = { read: async () => saved, write: async (_scope: unknown, doc: PrototypeEditCommentsDocument) => { saved = doc; } };
  const changes = { normalizeNote: (value: string) => value, syncEditMetaWithTransactions: vi.fn() } as never;
  const service = createPersistenceService({ state, changes, getPersistenceScope: () => scope, persistenceAdapter: adapter });
  service.flushPendingWrite(); await service.waitForPendingWrites();
  expect(saved.comments.map(entry => entry.purpose)).toEqual(records.map(record => record.entry.purpose));
  expect(saved.images[0].commentId).toBe('comment-0');
  const restored = createEditorRuntimeState();
  const restore = createPersistenceService({ state: restored, changes, getPersistenceScope: () => scope, persistenceAdapter: adapter });
  await restore.restoreCachedChanges();
  expect(restored.componentCommentsById.size).toBe(4);
  expect(restored.componentCommentsById.get('comment-1')?.entry.comment || '').toBe('');
  expect(restored.componentCommentsById.get('comment-1')?.entry.skillIds).toEqual(['layout']);
  expect(restored.componentCommentsById.get('comment-0')?.images[0].id).toBe('img');
  expect(restored.editMetaByKey.size).toBe(0);
  restore.flushPendingWrite(); await restore.waitForPendingWrites();
  expect(saved.comments).toHaveLength(4);
});

it('preserves blank notes, skills and images in local-only storage after acknowledging text or styles', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  const state = createEditorRuntimeState();
  state.componentCommentsById.set('one', { entry: { id: 'one', elementKey: 'button', locator, componentComment: true, purpose: 'modify-prototype', comment: '', skillIds: ['layout'], state: 'idle' },
    images: [{ id: 'image', name: 'one.png', data: 'data:image/png;base64,AA==', mimeType: 'image/png', size: 1, createdAt: 1 }] });
  state.componentCommentsById.set('blank', { entry: { id: 'blank', elementKey: 'button', locator, componentComment: true, purpose: 'modify-prototype', comment: '', state: 'idle' }, images: [] });
  const changes = { normalizeNote: (value: string) => value, syncEditMetaWithTransactions: vi.fn() } as never;
  const service = createPersistenceService({ state, changes, getPersistenceScope: () => scope });
  service.flushPendingWrite(); service.clearCachedChanges('text'); service.clearCachedChanges('style');
  const restored = createEditorRuntimeState();
  await createPersistenceService({ state: restored, changes, getPersistenceScope: () => scope }).restoreCachedChanges();
  expect(restored.componentCommentsById.get('one')?.entry.purpose).toBe('modify-prototype');
  expect(restored.componentCommentsById.get('one')?.images[0].id).toBe('image');
  expect(restored.componentCommentsById.get('one')?.entry.skillIds).toEqual(['layout']);
  expect(restored.componentCommentsById.get('blank')?.entry.comment).toBe('');
});

it('clears managed records from runtime after a successful clear and never resurrects them on flush', async () => {
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' }, localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const state = createEditorRuntimeState();
  state.componentCommentsById.set('one', { entry: { id: 'one', elementKey: 'button', locator, componentComment: true, purpose: 'modify-prototype', comment: 'clear', state: 'idle' }, images: [] });
  let saved!: PrototypeEditCommentsDocument;
  const service = createPersistenceService({ state, changes: {} as never, getPersistenceScope: () => scope,
    persistenceAdapter: { read: async () => saved, write: async (_, doc) => { saved = doc; } } });
  service.flushPendingWrite(); await service.waitForPendingWrites();
  await service.clearStorage('page', 'all');
  expect(state.componentCommentsById.size).toBe(0);
  service.flushPendingWrite(); await service.waitForPendingWrites();
  expect(saved.comments).toHaveLength(0);
});

it('ignores a slow old-page restore after a newer page has restored its records', async () => {
  const location = { pathname: '/a', search: '', hash: '' };
  vi.stubGlobal('window', { location, localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const state = createEditorRuntimeState();
  const document = (id: string): PrototypeEditCommentsDocument => ({ schemaVersion: 3, kind: 'prototype-edit-comments', resource: { id: 'home', targetPath: 'prototypes/home', filePath: '' }, comments: [
    { id, elementKey: 'button', pageScope: id, locator, componentComment: true, purpose: 'modify-prototype', comment: id, state: 'idle' },
  ], images: [] });
  let resolveA!: (document: PrototypeEditCommentsDocument) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<PrototypeEditCommentsDocument>(resolve => { resolveA = resolve; })).mockResolvedValueOnce(document('/b'));
  const service = createPersistenceService({ state, changes: { syncEditMetaWithTransactions: vi.fn() } as never, getPersistenceScope: () => scope, persistenceAdapter: { read, write: vi.fn() } });
  const restoringA = service.restoreCachedChanges();
  location.pathname = '/b'; await service.restoreCachedChanges();
  expect([...state.componentCommentsById.keys()]).toEqual(['/b']);
  resolveA(document('/a')); await restoringA;
  expect([...state.componentCommentsById.keys()]).toEqual(['/b']);
});

it('does not relabel or flush old-page records while the next page is restoring', async () => {
  const location = { pathname: '/b', search: '', hash: '' };
  vi.stubGlobal('window', { location, localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const state = createEditorRuntimeState();
  state.componentCommentsById.set('a', { entry: { id: 'a', elementKey: 'button', pageScope: '/a', locator, componentComment: true, purpose: 'modify-prototype', comment: 'A', state: 'idle' }, images: [] });
  let finish!: (doc: PrototypeEditCommentsDocument) => void;
  const write = vi.fn();
  const service = createPersistenceService({ state, changes: { syncEditMetaWithTransactions: vi.fn() } as never, getPersistenceScope: () => scope,
    persistenceAdapter: { read: () => new Promise(resolve => { finish = resolve; }), write } });
  const restoring = service.restoreCachedChanges();
  service.flushPendingWrite(); await service.waitForPendingWrites();
  expect(write).not.toHaveBeenCalled();
  expect(state.componentCommentsById.get('a')?.entry.pageScope).toBe('/a');
  finish({ schemaVersion: 3, kind: 'prototype-edit-comments', resource: { id: 'home', targetPath: 'prototypes/home', filePath: '' }, comments: [], images: [] });
  await restoring;
});
