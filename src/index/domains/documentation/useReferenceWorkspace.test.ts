import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useReferenceWorkspace } from './useReferenceWorkspace';
import { referenceRequest, type ReferencePage } from './referencePagesClient';
vi.mock('./referencePagesClient', () => ({ referenceRequest: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const makePage = (id: string, sourceFingerprint = ''): ReferencePage => ({ id, sourceFingerprint, title: id, entryPath: 'home.html', htmlFiles: ['home.html'], createdAt: '', warnings: [], previewUrl: '' });
it('polls while references are active, updates the selected snapshot, and falls back after deletion', async () => {
  vi.useFakeTimers();
  let state!: ReturnType<typeof useReferenceWorkspace>;
  const first = makePage('first', 'v1'), second = makePage('second');
  vi.mocked(referenceRequest).mockResolvedValue({ pages: [first, second], localSource: { directory: '/publish' } });
  function Probe() { state = useReferenceWorkspace('p'); return null; }
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(Probe)); });
  expect(state.selected?.id).toBe('first');
  await act(async () => state.setActive(true));
  vi.mocked(referenceRequest).mockResolvedValue({ pages: [makePage('first', 'v2'), second], localSource: { directory: '/publish' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(state.selected?.sourceFingerprint).toBe('v2');
  await act(async () => state.deleted('first'));
  expect(state.selected?.id).toBe('second');
  await act(async () => state.setActive(false));
  const calls = vi.mocked(referenceRequest).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(vi.mocked(referenceRequest).mock.calls.length).toBe(calls);
  await act(async () => view.unmount());
});
