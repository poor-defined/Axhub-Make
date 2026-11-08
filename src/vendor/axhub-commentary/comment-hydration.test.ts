import { afterEach, expect, it, vi } from 'vitest';
import { createPersistenceService } from '../../../vendor/axhub-commentary/src/core/editor/persistence';
import { createEditorRuntimeState } from '../../../vendor/axhub-commentary/src/core/editor/state';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('surfaces rejected comment hydration without clearing the current page annotations', async () => {
  vi.stubGlobal('window', { location: { pathname: '/prototypes/home', search: '', hash: '' } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const state = createEditorRuntimeState();
  state.editMetaByKey.set('existing', { note: 'Keep this local note' } as never);
  const service = createPersistenceService({ state, changes: {} as never,
    getPersistenceScope: () => ({ targetPath: 'prototypes/home', storageScope: 'test-hydration', prototypeId: 'home', filePath: 'src/prototypes/home/index.tsx', resource: null }),
    persistenceAdapter: { read: async () => { throw new Error('read rejected'); }, write: vi.fn() },
  });
  await expect(service.restoreCachedChanges()).rejects.toThrow('read rejected');
  expect(state.editMetaByKey.get('existing')?.note).toBe('Keep this local note');
});
