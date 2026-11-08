/** Inform the fixed-resource host after a cached HTML navigation installs its editor bridge. */
export function notifyReferencePageReady(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  if (!/^\/api\/projects\/[^/]+\/reference-pages\/[^/]+\/files\//u.test(window.location.pathname))
    return;
  window.parent.postMessage({ type: 'AXHUB_REFERENCE_PAGE_READY', url: window.location.href }, '*');
}
