import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestParentAxureExport } from './axureExportBridge';

afterEach(() => vi.unstubAllGlobals());

describe('HTML selection Axure bridge', () => {
  it('passes the selected payload to the trusted Make parent and validates its response', async () => {
    const target = new EventTarget();
    const origin = 'http://127.0.0.1:53818';
    const payload = { scene: { items: [] } };
    const parent = { postMessage: vi.fn((request) => queueMicrotask(() => {
      for (const responseOrigin of ['http://wrong.test', origin]) {
        const event = new Event('message') as MessageEvent;
        Object.assign(event, { origin: responseOrigin, source: parent, data: {
          type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_RESULT', requestId: request.requestId, handled: true,
        } });
        target.dispatchEvent(event);
      }
    })) };
    vi.stubGlobal('window', { parent, addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target), setTimeout, clearTimeout });
    await expect(requestParentAxureExport(payload, origin)).resolves.toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST', action: { type: 'prepare-axure-export', payload },
    }), origin);
  });
  it('does not send payloads without a trusted Make origin', async () => {
    vi.stubGlobal('window', { parent: { postMessage: vi.fn() } });
    expect(await requestParentAxureExport({}, '')).toBe(false);
    expect(window.parent.postMessage).not.toHaveBeenCalled();
  });
});
