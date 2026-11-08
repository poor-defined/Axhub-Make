import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReferenceCommentsBridge } from './referenceCommentsBridge';
afterEach(() => vi.unstubAllGlobals());
function setup(success = true) {
  const target = new EventTarget();
  const origin = 'http://127.0.0.1:53818';
  const parent = {
    postMessage: vi.fn((request: any) =>
      queueMicrotask(() => {
        for (const candidate of ['http://wrong.test', origin]) {
          const event = new Event('message') as MessageEvent;
          Object.assign(event, {
            source: parent,
            origin: candidate,
            data: {
              type: 'AXHUB_REFERENCE_COMMENTS_RESULT',
              requestId: request.requestId,
              success,
              document: { version: 1 },
              error: '写入失败',
            },
          });
          target.dispatchEvent(event);
        }
      }),
    ),
  };
  vi.stubGlobal('window', {
    parent,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    setTimeout,
    clearTimeout,
  });
  return { parent, origin, adapter: createReferenceCommentsBridge(() => origin) };
}
describe('opaque reference comments bridge', () => {
  it('reads from authenticated parent without sending project paths supplied by the embedded page', async () => {
    const { adapter, parent, origin } = setup();
    expect(await adapter.read({ targetPath: 'secrets' } as any)).toEqual({ version: 1 });
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AXHUB_REFERENCE_COMMENTS_REQUEST', operation: 'read' }),
      origin,
    );
    expect(parent.postMessage.mock.calls[0][0]).not.toHaveProperty('path');
  });
  it('passes document and tombstones to parent and rejects server failure', async () => {
    const { adapter, parent } = setup(false);
    const document = { version: 1 } as any;
    const observedTombstones = [{ kind: 'comment', id: 'one' }] as any;
    await expect(
      adapter.write({} as any, document, 'changes', { observedTombstones }),
    ).rejects.toThrow('写入失败');
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({
      operation: 'write',
      document,
      reason: 'changes',
      observedTombstones,
    });
  });
  it('rejects requests before the parent enable handshake establishes trust', async () => {
    const { parent } = setup();
    await expect(createReferenceCommentsBridge(() => '').read({} as any)).rejects.toThrow('可信');
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
