import { afterEach, expect, it, vi } from 'vitest';
import { setPageZoomEnabled } from '../../../vendor/axhub-commentary/src/utils/page-zoom-toggle';
import * as zoom from '../../../vendor/axhub-commentary/src/utils/page-zoom-toggle';

function style() {
  const values = new Map<string, [string, string]>();
  return {
    getPropertyValue: (key: string) => values.get(key)?.[0] ?? '',
    getPropertyPriority: (key: string) => values.get(key)?.[1] ?? '',
    setProperty: (key: string, value: string, priority = '') => { values.set(key, [value, priority]); },
    removeProperty: (key: string) => { values.delete(key); },
  };
}
function setup() {
  const body = { style: style(), scrollWidth: 1200, querySelectorAll: () => [] };
  const html = { style: style(), clientWidth: 1200 };
  vi.stubGlobal('document', { body, documentElement: html, getElementById: () => null });
  vi.stubGlobal('window', { innerWidth: 1200, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  return { body, html };
}
afterEach(() => {
  setPageZoomEnabled(false, { owner: 'canvas-controls' });
  setPageZoomEnabled(false, { owner: 'comment-list' }); setPageZoomEnabled(false);
  vi.unstubAllGlobals();
});
it('exposes actual fit and manual percentages without scaling the editor chrome', () => {
  const { body } = setup();
  setPageZoomEnabled(true, { owner: 'canvas-controls' });
  setPageZoomEnabled(true, { owner: 'comment-list', reservedRightWidth: 360 });
  expect(zoom.getPageZoomView().scale).toBe(0.7);
  zoom.setPageZoomView(1.5);
  expect(zoom.getPageZoomView()).toMatchObject({ scale: 1.5, mode: 'manual' });
  expect(body.style.getPropertyValue('transform')).toContain('scale(1.5)');
  zoom.setPageZoomView('fit');
  expect(zoom.getPageZoomView()).toMatchObject({ scale: 0.7, mode: 'fit', panX: 0, panY: 0 });
});
it('zooms around the pointer, clamps unsafe values, and resets panning', () => {
  setup(); setPageZoomEnabled(true, { owner: 'canvas-controls' });
  zoom.setPageZoomView(2, { x: 300, y: 200 });
  expect(zoom.getPageZoomView()).toMatchObject({ panX: -300, panY: -200 });
  zoom.panPageZoom(20, 30);
  expect(zoom.getPageZoomView()).toMatchObject({ panX: -280, panY: -170 });
  zoom.setPageZoomView(100);
  expect(zoom.getPageZoomView().scale).toBe(3);
  zoom.setPageZoomView(Number.NaN);
  expect(Number.isFinite(zoom.getPageZoomView().scale)).toBe(true);
  zoom.setPageZoomView(1);
  expect(zoom.getPageZoomView()).toMatchObject({ scale: 1, panX: 0, panY: 0 });
});
it('keeps native page transforms when an inactive panel releases its reservation', () => {
  const { body } = setup();
  body.style.setProperty('transform', 'scale(0.75)', 'important');
  setPageZoomEnabled(false);
  expect(body.style.getPropertyValue('transform')).toBe('scale(0.75)');
});
it('reserves the largest visible panel and restores original styles only after the last owner closes', () => {
  const { body, html } = setup();
  body.style.setProperty('transform', 'translateY(4px)', 'important');
  html.style.setProperty('overflow-x', 'clip');
  setPageZoomEnabled(true, { reservedRightWidth: 300 });
  setPageZoomEnabled(true, { owner: 'comment-list', reservedRightWidth: 372 });
  expect(body.style.getPropertyValue('transform')).toContain('scale(0.69)');
  expect(body.style.getPropertyValue('transform')).toContain('translateY(4px)');
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'commentary:page-layout-change' }));
  setPageZoomEnabled(false);
  expect(body.style.getPropertyValue('transform')).toContain('scale(0.69)');
  setPageZoomEnabled(false, { owner: 'comment-list' });
  expect(body.style.getPropertyValue('transform')).toBe('translateY(4px)');
  expect(body.style.getPropertyPriority('transform')).toBe('important');
  expect(html.style.getPropertyValue('overflow-x')).toBe('clip');
});
it('keeps pointer zoom finite when a panel is wider than the viewport', () => {
  const { body } = setup();
  setPageZoomEnabled(true, { reservedRightWidth: 2000 });
  expect(zoom.getPageZoomView().scale).toBeGreaterThan(0);
  zoom.setPageZoomView(1, { x: 100, y: 100 });
  expect(body.style.getPropertyValue('transform')).not.toMatch(/NaN|Infinity/);
});
it('does not rescan a large document on every zoom or pan frame', () => {
  const { body } = setup(); const scan = vi.fn(() => []); body.querySelectorAll = scan;
  setPageZoomEnabled(true, { owner: 'canvas-controls' });
  const initial = scan.mock.calls.length;
  zoom.setPageZoomView(1.5); zoom.panPageZoom(10, 10); zoom.setPageZoomView(2, { x: 100, y: 100 });
  expect(scan).toHaveBeenCalledTimes(initial);
  zoom.setPageZoomView('fit');
  expect(scan).toHaveBeenCalledTimes(initial + 1);
});
it('recovers the original page styles after the native panel clears them while closing', () => {
  const { body } = setup(); body.style.setProperty('transform', 'translateY(4px)');
  setPageZoomEnabled(true, { owner: 'canvas-controls' });
  zoom.suspendPageZoomForNativePanel();
  setPageZoomEnabled(false, { owner: 'canvas-controls' });
  body.style.removeProperty('transform'); // Native cleanup plus its inactive effect.
  setPageZoomEnabled(true, { owner: 'canvas-controls' });
  expect(body.style.getPropertyValue('transform')).toContain('translateY(4px)');
  setPageZoomEnabled(false, { owner: 'canvas-controls' });
  expect(body.style.getPropertyValue('transform')).toBe('translateY(4px)');
});
