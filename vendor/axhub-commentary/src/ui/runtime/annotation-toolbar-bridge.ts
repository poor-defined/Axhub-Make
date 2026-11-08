/** Join the native annotation chrome without replacing its registered toolbar actions. */
export function connectAnnotationToolbar(
  ownerDocument: Document,
  onMountChange: (mount: HTMLElement | null) => void,
  onNativeAction: () => void,
): { closePanels: () => void; dispose: () => void } {
  let toolbar: HTMLElement | null = null;
  let mount: HTMLElement | null = null;
  let observedShadow: ShadowRoot | null = null;
  let previousSelectionLock: string | null = null;
  let closingPanels = false;
  const handleNativeClick = (event: Event) => {
    if (!closingPanels && !event.composedPath().includes(mount as EventTarget)) onNativeAction();
  };
  const detach = () => {
    toolbar?.removeEventListener('click', handleNativeClick, true);
    if (previousSelectionLock === null) toolbar?.removeAttribute('data-we-selection-lock-root');
    else toolbar?.setAttribute('data-we-selection-lock-root', previousSelectionLock);
    mount?.remove();
    toolbar = null;
    mount = null;
  };
  const sync = () => {
    const shadow = ownerDocument.getElementById('__axhub_annotation_host__')?.shadowRoot ?? null;
    if (shadow !== observedShadow) {
      observer.disconnect();
      observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
      if (shadow) observer.observe(shadow, { childList: true, subtree: true });
      observedShadow = shadow;
    }
    const next = shadow?.querySelector<HTMLElement>('.axhub-annotation-edge-toolbar') ?? null;
    if (next === toolbar && (!mount || toolbar?.contains(mount))) return;
    detach();
    toolbar = next;
    if (toolbar) {
      previousSelectionLock = toolbar.getAttribute('data-we-selection-lock-root');
      toolbar.setAttribute('data-we-selection-lock-root', 'true');
      toolbar.addEventListener('click', handleNativeClick, true);
      mount = ownerDocument.createElement('div');
      mount.setAttribute('data-we-right-entry-slot', 'true');
      mount.setAttribute('data-we-selection-lock-root', 'true');
      mount.setAttribute('data-axhub-annotation-direct-action', 'true');
      mount.style.display = 'contents';
      toolbar.insertBefore(mount, toolbar.querySelector('.axhub-annotation-settings-trigger'));
    }
    onMountChange(mount);
  };
  const observer = new MutationObserver(sync);
  observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
  sync();
  return {
    closePanels() {
      closingPanels = true;
      try {
        // The native API only closes the prototype directory; toggle both directory kinds
        // and settings through their own controls so their internal state stays in sync.
        toolbar?.querySelectorAll<HTMLButtonElement>(
          '.axhub-annotation-edge-button[aria-pressed="true"], .axhub-annotation-edge-button[aria-expanded="true"]',
        ).forEach(button => button.click());
      } finally { closingPanels = false; }
    },
    dispose() { observer.disconnect(); detach(); },
  };
}
