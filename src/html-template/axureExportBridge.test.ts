import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestParentAxureExport, requestParentComponentAction, requestParentHostToolbarAction } from './axureExportBridge';

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


it('delivers a documentation capture through the same authenticated channel', async () => {
  const target = new EventTarget();
  const origin = 'http://127.0.0.1:53818';
  const payload = { imageDataUrl: 'data:image/png;base64,cGlj', note: '' };
  const parent = { postMessage: vi.fn((request) => queueMicrotask(() => {
    const event = new Event('message') as MessageEvent;
    Object.assign(event, { origin, source: parent, data: {
      type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_RESULT', requestId: request.requestId, handled: true,
    } });
    target.dispatchEvent(event);
  })) };
  vi.stubGlobal('window', { parent, addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target), setTimeout, clearTimeout });
  await expect(requestParentComponentAction('document-component', payload, origin)).resolves.toBe(true);
  expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'document-component', payload } }), origin);
});


it('forwards prototype generation instructions to the trusted reference host', async () => {
  const target = new EventTarget(); const origin = 'http://127.0.0.1:53818';
  const action = { type: 'send-to-agent' as const, promptText: '平铺组件的所有状态' };
  const parent = { postMessage: vi.fn((request) => queueMicrotask(() => {
    const event = new Event('message') as MessageEvent;
    Object.assign(event, { origin, source: parent, data: { type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_RESULT', requestId: request.requestId, handled: true } });
    target.dispatchEvent(event);
  })) };
  vi.stubGlobal('window', { parent, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), setTimeout, clearTimeout });
  expect(await requestParentHostToolbarAction(action, origin)).toBe(true);
  expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action }), origin);
});
