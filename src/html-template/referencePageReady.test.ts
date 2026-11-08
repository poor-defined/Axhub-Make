import { afterEach, expect, it, vi } from 'vitest';
import { notifyReferencePageReady } from './referencePageReady';
afterEach(() => vi.unstubAllGlobals());
it('reports bootstrap readiness and the active cached reference URL after page navigation', () => {
  const parent = { postMessage: vi.fn() };
  const href = 'http://127.0.0.1:53818/api/projects/demo/reference-pages/ref123/files/next.html';
  vi.stubGlobal('window', { parent, location: { pathname: new URL(href).pathname, href } });
  notifyReferencePageReady();
  expect(parent.postMessage).toHaveBeenCalledWith(
    { type: 'AXHUB_REFERENCE_PAGE_READY', url: href },
    '*',
  );
});
it('does not report a normal project document as a cached reference', () => {
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    parent,
    location: { pathname: '/docs/prd.html', href: 'http://127.0.0.1:53818/docs/prd.html' },
  });
  notifyReferencePageReady();
  expect(parent.postMessage).not.toHaveBeenCalled();
});
