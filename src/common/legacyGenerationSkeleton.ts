import { isLegacyGenerationPlaceholder, renderLoadingSkeleton } from './loadingSkeleton';
/** Temporary preview decoration; leaves React-managed children and source files untouched. */
export function installLegacyGenerationSkeleton(root: HTMLElement): () => void {
  const cleanupKey = Symbol.for('axhub.legacyGenerationSkeleton.cleanup');
  const managedRoot = root as HTMLElement & { [key: symbol]: (() => void) | undefined };
  managedRoot[cleanupKey]?.(); // Includes bootstrap re-imports and Vite hot updates.
  let overlay: HTMLDivElement | null = null;
  let hidden: Element | null = null;
  let previousAria: string | null = null;
  const restore = () => {
    if (hidden) { if (previousAria === null) hidden.removeAttribute('aria-hidden'); else hidden.setAttribute('aria-hidden', previousAria); }
    hidden = null; overlay?.remove(); overlay = null;
  };
  const update = () => {
    const target = root.children.length === 1 ? root.firstElementChild : null;
    if (!target || !root.isConnected || target.textContent?.trim() !== '正在等待生成'
      || !isLegacyGenerationPlaceholder(target.className, target.children)
      || getComputedStyle(target).display === 'none' || getComputedStyle(target).visibility === 'hidden') { restore(); return; }
    if (hidden === target) return;
    restore(); hidden = target; previousAria = target.getAttribute('aria-hidden'); target.setAttribute('aria-hidden', 'true');
    overlay = document.createElement('div'); overlay.dataset.legacyGenerationSkeleton = 'true';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1;overflow:hidden;background:#fff;pointer-events:none;min-height:100vh';
    overlay.innerHTML = renderLoadingSkeleton('preview', '原型正在生成');
    document.body.append(overlay);
  };
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  update();
  const cleanup = () => { observer.disconnect(); restore(); if (managedRoot[cleanupKey] === cleanup) delete managedRoot[cleanupKey]; };
  managedRoot[cleanupKey] = cleanup;
  return cleanup;
}
