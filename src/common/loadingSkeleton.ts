export type SkeletonVariant = 'preview' | 'document' | 'list' | 'table' | 'canvas' | 'cards' | 'form';
const block = (name = '') => `<div class="ax-sk-block ${name}"></div>`;
const lines = () => `<div class="ax-sk-lines">${block('ax-sk-line ax-sk-wide')}${block('ax-sk-line')}${block('ax-sk-line ax-sk-short')}</div>`;
const header = `<div class="ax-sk-header">${block('ax-sk-logo')}<div class="ax-sk-nav">${block()}${block()}${block()}</div>${block('ax-sk-action')}</div>`;
const cards = `<div class="ax-sk-cards">${Array.from({ length: 3 }, () => `<div class="ax-sk-card">${block('ax-sk-media')}${lines()}</div>`).join('')}</div>`;
export const skeletonLayouts: Record<SkeletonVariant, string> = {
  preview: `${header}<div class="ax-sk-hero"><div>${block('ax-sk-title')}${block('ax-sk-title ax-sk-short')}${lines()}${block('ax-sk-button')}</div>${block('ax-sk-hero-media')}</div>${cards}`,
  document: `<div class="ax-sk-document">${block('ax-sk-title')}${block('ax-sk-line ax-sk-short')}${lines()}${lines()}${block('ax-sk-document-media')}${lines()}${lines()}</div>`,
  list: Array.from({ length: 5 }, () => `<div class="ax-sk-row">${block('ax-sk-avatar')}${lines()}</div>`).join(''),
  table: `${block('ax-sk-title')}<div class="ax-sk-table">${Array.from({ length: 7 }, () => `<div class="ax-sk-table-row">${block()}${block()}${block()}${block()}</div>`).join('')}</div>`,
  canvas: `<div class="ax-sk-canvas">${block('ax-sk-canvas-tools')}<div class="ax-sk-canvas-sheets">${block()}${block()}${block()}</div></div>`,
  cards,
  form: `${block('ax-sk-title')}${Array.from({ length: 3 }, () => `<div class="ax-sk-field">${block('ax-sk-line ax-sk-short')}${block('ax-sk-input')}</div>`).join('')}`,
};
export const LOADING_SKELETON_CSS = `
.ax-page-skeleton{--ax-sk-fill:#e9edf1;--ax-sk-shine:#f4f6f8;box-sizing:border-box;width:100%;height:100%;min-height:inherit;overflow:hidden;padding:clamp(16px,3vw,40px);text-align:left;pointer-events:none}
.ax-page-skeleton *{box-sizing:border-box}.ax-page-skeleton>[aria-hidden]{height:100%}.placeholder-empty-page>div,.prototype-waiting-generation-page>div{min-height:100vh}
.dark [data-legacy-generation-skeleton],[data-theme="dark"] [data-legacy-generation-skeleton],.dark .placeholder-empty-page,.dark .prototype-waiting-generation-page{background:#0f1720!important}
.dark .ax-page-skeleton,[data-theme="dark"] .ax-page-skeleton{--ax-sk-fill:#28323c;--ax-sk-shine:#36424e}
.ax-sk-block{min-width:0;border-radius:6px;background:var(--ax-sk-fill);animation:ax-sk-pulse 1.8s ease-in-out infinite}
.ax-sk-header{display:flex;align-items:center;gap:20px;margin-bottom:clamp(24px,5vw,64px);padding-bottom:20px;border-bottom:1px solid var(--ax-sk-fill)}
.ax-sk-logo{width:112px;height:24px}.ax-sk-action{width:80px;height:30px;margin-left:auto}.ax-sk-nav{display:flex;gap:20px;margin-left:auto}.ax-sk-nav>div{width:52px;height:12px}
.ax-sk-hero{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,5vw,72px);align-items:center;margin-bottom:40px}.ax-sk-title{width:80%;height:28px;margin-bottom:16px}.ax-sk-short{width:55%!important}.ax-sk-wide{width:90%!important}
.ax-sk-lines{display:flex;flex-direction:column;gap:10px;margin:20px 0;width:100%;min-width:0}.ax-sk-line{height:10px;width:75%}.ax-sk-button{width:112px;height:34px;margin-top:24px}.ax-sk-hero-media{height:clamp(130px,20vw,270px)}
.ax-sk-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.ax-sk-card{padding:16px;border:1px solid var(--ax-sk-fill);border-radius:10px}.ax-sk-card .ax-sk-lines{margin-bottom:4px}.ax-sk-media{height:90px}.ax-sk-document{max-width:800px;margin:0 auto}.ax-sk-document>.ax-sk-lines{margin:28px 0}.ax-sk-document-media{height:170px;margin:30px 0}
.ax-skeleton--list{padding:12px 8px;min-height:0}.ax-sk-row{display:flex;align-items:center;gap:12px;padding:10px 4px}.ax-sk-avatar{height:30px;width:30px;flex-shrink:0}.ax-sk-row .ax-sk-lines{margin:0;gap:7px}.ax-sk-row .ax-sk-line{height:8px}.ax-sk-row .ax-sk-lines>div:last-child{display:none}
.ax-sk-table{margin-top:24px;border:1px solid var(--ax-sk-fill);border-radius:8px;overflow:hidden}.ax-sk-table-row{display:grid;grid-template-columns:1fr 2fr 2fr 1fr;gap:20px;padding:18px;border-bottom:1px solid var(--ax-sk-fill)}.ax-sk-table-row:last-child{border-bottom:0}.ax-sk-table-row>div{height:12px}
.ax-skeleton--canvas{padding:18px}.ax-sk-canvas{position:relative;min-height:260px;height:100%;border-radius:10px;background-image:radial-gradient(var(--ax-sk-fill) 1px,transparent 1px);background-size:18px 18px}.ax-sk-canvas-tools{position:absolute;width:36px;height:160px;left:12px;top:12px}.ax-sk-canvas-sheets{display:flex;gap:20px;padding:72px 7% 36px 80px}.ax-sk-canvas-sheets>div{height:180px;flex:1;border:1px solid var(--ax-sk-fill);background:var(--ax-sk-shine)}
.ax-sk-field{margin-top:24px}.ax-sk-input{height:38px;margin-top:10px}.ax-sk-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes ax-sk-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media(max-width:640px){.ax-sk-nav{display:none}.ax-sk-hero{grid-template-columns:1fr;gap:22px;margin-bottom:24px}.ax-sk-hero-media{height:140px}.ax-sk-cards{grid-template-columns:1fr;gap:12px}.ax-sk-card{display:flex;align-items:center;gap:14px;padding:12px}.ax-sk-media{height:60px;width:80px;flex-shrink:0}.ax-sk-title{height:23px}.ax-sk-canvas-sheets{padding-left:64px;gap:10px}.ax-sk-canvas-sheets>div:last-child{display:none}.ax-sk-table-row{gap:12px;padding:14px}}
@media(prefers-reduced-motion:reduce){.ax-page-skeleton .ax-sk-block{animation:none}}
`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** Shared trusted layout used by React, standalone templates and generated stubs. */
export function renderLoadingSkeleton(variant: SkeletonVariant = 'preview', label = '正在加载内容'): string {
  const kind = Object.prototype.hasOwnProperty.call(skeletonLayouts, variant) ? variant : 'preview';
  return `<style>${LOADING_SKELETON_CSS}</style><div class="ax-page-skeleton ax-skeleton--${kind}" role="status" aria-busy="true" aria-label="${escapeHtml(label)}"><div aria-hidden="true">${skeletonLayouts[kind]}</div><span class="ax-sk-sr-only">${escapeHtml(label)}</span></div>`;
}
export function isLegacyGenerationPlaceholder(className: string, children: ArrayLike<{ tagName: string; textContent: string | null; childElementCount?: number }>): boolean {
  return /(?:^|\s)(?:prototype-waiting-generation-page|placeholder-empty-page)(?:\s|$)/u.test(className)
    && children.length === 1 && children[0].tagName === 'SPAN' && !children[0].childElementCount && children[0].textContent?.trim() === '正在等待生成';
}
/** Fill critical first-paint HTML from the same layouts during dev/build, without a fetch. */
export function expandLoadingSkeletonShells(html: string): string {
  return html.replace(/<!--\s*AXHUB_PAGE_SKELETON:(preview|document|list|table|canvas|cards|form)\s*-->/gu, (_marker, variant: SkeletonVariant) => renderLoadingSkeleton(variant));
}
