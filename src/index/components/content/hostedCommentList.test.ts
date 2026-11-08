import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { acceptsCommentDockMessage, useHostedCommentList } from './useHostedCommentList';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('accepts only the mounted preview window and its exact origin', () => {
  const child = {}; const frame = { isConnected: true, contentWindow: child, src: 'http://runtime.test/page' } as unknown as HTMLIFrameElement;
  const event = { source: child, origin: 'http://runtime.test', data: { type: 'AXHUB_COMMENT_LIST_DOCK', kind: 'state' } } as unknown as MessageEvent;
  expect(acceptsCommentDockMessage(event, frame)).toBe(true);
  expect(acceptsCommentDockMessage({ ...event, source: {} } as MessageEvent, frame)).toBe(false);
  expect(acceptsCommentDockMessage({ ...event, origin: 'http://other.test' } as MessageEvent, frame)).toBe(false);
  expect(acceptsCommentDockMessage(event, { ...frame, isConnected: false } as HTMLIFrameElement)).toBe(false);
});
it('binds the dock to the resource generation and refuses late states from the previous document', async () => {
  vi.useFakeTimers();
  const owner = Object.assign(new EventTarget(), { innerWidth: 1600 }); vi.stubGlobal('window', owner);
  const postMessage = vi.fn(); const child = { postMessage };
  const frame = { isConnected: true, contentWindow: child, src: 'http://runtime.test/page' } as unknown as HTMLIFrameElement;
  const frameRef = { current: frame };
  function Harness({ resource }: { resource: string }) { const dock = useHostedCommentList(frameRef, resource, true); return React.createElement('div', { 'data-open': dock.open }, dock.panel); }
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(Harness, { resource: 'a' })); });
  const generationA = postMessage.mock.calls.find(([message]) => message.kind === 'probe')![0].generation;
  const state = (session: string, scope: string) => ({ session, scope, open: true, entries: [], selectedIds: [], darkMode: true, loadState: { status: 'ready' }, sendAvailable: true, generateAvailable: true, documentAvailable: true });
  const send = async (generation: string, snapshot: unknown) => act(async () => {
    const event = new Event('message'); Object.assign(event, { source: child, origin: 'http://runtime.test', data: { type: 'AXHUB_COMMENT_LIST_DOCK', kind: 'state', generation, state: snapshot } }); owner.dispatchEvent(event);
  });
  await send(generationA, state('session-a', 'scope-a'));
  expect(view.root.findByProps({ 'data-open': true })).toBeTruthy();
  expect(view.root.findByProps({ 'data-hosted-comment-list': 'true' }).props.style['--we-editor-surface']).not.toBe('#ffffff');
  postMessage.mockClear();
  await act(async () => view.update(React.createElement(Harness, { resource: 'b' })));
  const generationB = postMessage.mock.calls.find(([message]) => message.kind === 'probe')![0].generation;
  expect(generationB).not.toBe(generationA);
  await send(generationA, state('session-a', 'scope-a'));
  expect(view.root.findByProps({ 'data-open': false })).toBeTruthy();
  await send(generationB, state('session-a', 'scope-a'));
  expect(view.root.findByProps({ 'data-open': false })).toBeTruthy();
  await send(generationB, state('session-b', 'scope-b'));
  expect(view.root.findByProps({ 'data-open': true })).toBeTruthy();
  await send(generationB, state('session-a', 'scope-a'));
  expect(view.root.findByProps({ 'data-open': true })).toBeTruthy();
  expect(postMessage.mock.calls.at(-1)![0].session).toBe('session-b');
  await act(async () => view.unmount());
});
