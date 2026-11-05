import { afterEach, expect, it, vi } from 'vitest';
import { maintainAssistantWindowPolicy, syncAssistantWindowContext } from './assistantWindowContext';
import { PROTOTYPE_WIREFRAME_POLICY } from '../../../common/prototypeWireframePolicy';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function harness() {
  vi.useFakeTimers();
  const events = new EventTarget();
  const host = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    setTimeout, clearTimeout };
  vi.stubGlobal('window', host);
  const child = { closed: false, postMessage: vi.fn() };
  const ack = (request: { requestId: string }, origin = 'http://acp.test', source: unknown = child) => {
    const event = new Event('message');
    Object.assign(event, { data: { type: 'acp.context.result', requestId: request.requestId }, origin, source });
    events.dispatchEvent(event);
  };
  return { child, ack, events };
}

it('restores only the missing policy after a window refresh without replacing business context', async () => {
  const { child, events } = harness();
  let items: unknown[] = [{ id: 'axhub:project-policy:wireframe' }, { id: 'business-selection' }];
  child.postMessage.mockImplementation((request) => {
    if (request.type !== 'acp.context.get') return;
    const event = new Event('message');
    Object.assign(event, { source: child, origin: 'http://acp.test', data: {
      type: 'acp.context.result', requestId: request.requestId, payload: { context: { items } },
    } });
    events.dispatchEvent(event);
  });
  const stop = maintainAssistantWindowPolicy(child as unknown as Window, 'http://acp.test');
  expect(child.postMessage.mock.calls.some(([request]) => request.type === 'acp.context.add')).toBe(false);
  items = [{ id: 'business-selection' }]; // Child reload lost its in-memory policy.
  await vi.advanceTimersByTimeAsync(2000);
  const additions = child.postMessage.mock.calls.filter(([request]) => request.type === 'acp.context.add');
  expect(additions).toHaveLength(1);
  expect(additions[0][0].payload.items).toHaveLength(1);
  expect(additions[0][0].payload.items[0].body).toBe(PROTOTYPE_WIREFRAME_POLICY);
  expect(child.postMessage.mock.calls.some(([request]) => request.type === 'acp.context.replace')).toBe(false);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['closed', 'pagehide'])('stops the policy probe when its window lifecycle ends (%s)', async (reason) => {
  const { child, events } = harness();
  maintainAssistantWindowPolicy(child as unknown as Window, 'http://acp.test');
  if (reason === 'closed') child.closed = true;
  else events.dispatchEvent(new Event('pagehide'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(vi.getTimerCount()).toBe(0);
  expect(child.postMessage).toHaveBeenCalledTimes(1);
});

it('delivers policy to a cold-start window after 1.2s and stops retries once acknowledged', async () => {
  const { child, ack } = harness();
  const done = syncAssistantWindowContext(child as unknown as Window, 'http://acp.test', null);
  await vi.advanceTimersByTimeAsync(2000);
  child.postMessage.mockImplementation((request) => ack(request));
  await vi.advanceTimersByTimeAsync(500);
  await expect(done).resolves.toBeUndefined();
  expect(child.postMessage.mock.lastCall?.[0].payload.items[0].body).toBe(PROTOTYPE_WIREFRAME_POLICY);
  const calls = child.postMessage.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(child.postMessage).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores acknowledgements from other origins/windows and cleans up on timeout', async () => {
  const { child, ack } = harness();
  const done = syncAssistantWindowContext(child as unknown as Window, 'http://acp.test', null);
  const failed = expect(done).rejects.toThrow('上下文同步超时');
  const request = child.postMessage.mock.calls[0][0];
  ack(request, 'http://other.test'); ack(request, 'http://acp.test', {});
  await vi.advanceTimersByTimeAsync(30000);
  await failed;
  expect(vi.getTimerCount()).toBe(0);
});

it('stops if the user closes the child window', async () => {
  const { child } = harness();
  const done = syncAssistantWindowContext(child as unknown as Window, 'http://acp.test', null);
  const failed = expect(done).rejects.toThrow('窗口已关闭');
  child.closed = true;
  await vi.advanceTimersByTimeAsync(500);
  await failed;
  expect(vi.getTimerCount()).toBe(0);
});
