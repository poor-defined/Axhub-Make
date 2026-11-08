import { describe, expect, it } from 'vitest';
import { getAxureSelectionRoots, assertMergeableSelection } from '../../../vendor/axhub-commentary/src/axure-selection';

function element(order: number, css: Record<string, string> = {}) {
  const style = { position: 'static', display: 'block', zIndex: 'auto', opacity: '1', transform: 'none', filter: 'none', isolation: 'auto', float: 'none', ...css };
  const target = { order, style, parentElement: null, ownerDocument: { defaultView: { getComputedStyle: (node: any) => node.style } },
    contains: (node: unknown) => node === target,
    compareDocumentPosition: (node: any) => order < node.order ? 4 : 2,
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 50 }),
  };
  return target as unknown as Element;
}

describe('Axure selection paint boundaries', () => {
  it('places positioned-auto content after normal flow even if selected/inserted first', () => {
    const positioned = element(1, { position: 'absolute' }), normal = element(2);
    expect(getAxureSelectionRoots([positioned, normal])).toEqual([normal, positioned]);
  });
  it('respects negative/positive z-index and ignores Command-click order', () => {
    const normal = element(2), front = element(1, { position: 'relative', zIndex: '4' }), back = element(3, { position: 'absolute', zIndex: '-1' });
    expect(getAxureSelectionRoots([front, normal, back])).toEqual([back, normal, front]);
  });
  it('rejects interleaved positioned descendants that cannot be merged as atomic roots', () => {
    const parent = element(1), other = element(2), floatingChild = element(3, { position: 'absolute', zIndex: '2' });
    parent.querySelectorAll = (() => [floatingChild]) as any;
    expect(() => assertMergeableSelection([parent, other])).toThrow(/层叠/);
  });
  it('allows an atomic stacking-context subtree and separated ordinary selections', () => {
    const parent = element(1, { position: 'relative', zIndex: '0' }), other = element(2);
    parent.querySelectorAll = (() => [element(3, { position: 'absolute', zIndex: '2' })]) as any;
    expect(() => assertMergeableSelection([parent, other])).not.toThrow();
  });
});
