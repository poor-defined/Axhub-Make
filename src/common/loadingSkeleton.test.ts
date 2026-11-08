import { expect, it } from 'vitest';
import { renderLoadingSkeleton, isLegacyGenerationPlaceholder, skeletonLayouts, expandLoadingSkeletonShells } from './loadingSkeleton';
it('renders distinct accessible content shapes without treating labels as HTML', () => {
  for (const variant of Object.keys(skeletonLayouts) as Array<keyof typeof skeletonLayouts>) {
    const html = renderLoadingSkeleton(variant, '<img src=x onerror=alert(1)>');
    expect(html).toContain('role="status"'); expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"'); expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  }
  expect(renderLoadingSkeleton('document')).not.toBe(renderLoadingSkeleton('table'));
});
it('puts the critical skeleton in HTML before scripts load, expands once and keeps unrelated markup intact', () => {
  const html = '<div id="root"><!-- AXHUB_PAGE_SKELETON:document --></div><script src="app.js"></script><!-- other -->';
  const expanded = expandLoadingSkeletonShells(html);
  expect(expanded.indexOf('role="status"')).toBeLessThan(expanded.indexOf('<script'));
  expect(expanded).not.toContain('AXHUB_PAGE_SKELETON');
  expect(expanded).toContain('<!-- other -->');
  expect(expandLoadingSkeletonShells(expanded)).toBe(expanded);
});
it('only recognizes the exact application-generated legacy waiting stub', () => {
  expect(isLegacyGenerationPlaceholder('prototype-waiting-generation-page', [{ tagName: 'SPAN', textContent: '正在等待生成' }])).toBe(true);
  expect(isLegacyGenerationPlaceholder('placeholder-empty-page', [{ tagName: 'SPAN', textContent: '正在等待生成' }])).toBe(true);
  expect(isLegacyGenerationPlaceholder('real-page', [{ tagName: 'SPAN', textContent: '正在等待生成' }])).toBe(false);
  expect(isLegacyGenerationPlaceholder('prototype-waiting-generation-page', [{ tagName: 'HEADER', textContent: '正在等待生成' }])).toBe(false);
  expect(isLegacyGenerationPlaceholder('prototype-waiting-generation-page', [{ tagName: 'SPAN', textContent: '已生成' }])).toBe(false);
  expect(isLegacyGenerationPlaceholder('prototype-waiting-generation-page', [{ tagName: 'SPAN', textContent: '正在等待生成', childElementCount: 1 }])).toBe(false);
});
