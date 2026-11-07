import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureElementScreenshot } from '../../../vendor/axhub-commentary/src/core/editor/screenshot';
const { toPng } = vi.hoisted(() => ({
  toPng: vi.fn(
    async (_node: HTMLElement, _options: { backgroundColor?: string }) =>
      'data:image/png;base64,cGlj',
  ),
}));
vi.mock('html-to-image', () => ({ toPng }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup(backgroundColor = 'rgba(0, 0, 0, 0)') {
  class FakeElement {
    parentElement: FakeElement | null = null;
    scrollWidth = 120;
    scrollHeight = 60;
    clientWidth = 120;
    clientHeight = 60;
    offsetWidth = 120;
    offsetHeight = 60;
    style = {};
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { width: 120, height: 60 };
    }
  }
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('SVGElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', {});
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    setTimeout: (callback: () => void) => {
      queueMicrotask(callback);
    },
    getComputedStyle: () => ({ backgroundColor, backgroundImage: 'none', boxSizing: 'border-box' }),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    queueMicrotask(callback);
  });
  return new FakeElement() as unknown as Element;
}
describe('documentation screenshot canvas background', () => {
  it('uses white fallback for an otherwise transparent document canvas', async () => {
    await captureElementScreenshot(setup(), 'component', { fallbackBackgroundColor: '#ffffff' });
    expect(toPng.mock.calls[0][1].backgroundColor).toBe('#ffffff');
  });
  it('preserves a real ancestor background instead of forcing white', async () => {
    await captureElementScreenshot(setup('rgb(20, 30, 40)'), 'component', {
      fallbackBackgroundColor: '#ffffff',
    });
    expect(toPng.mock.calls[0][1].backgroundColor).toBe('rgb(20, 30, 40)');
  });
  it('retains transparent captures for existing callers without documentation fallback', async () => {
    await captureElementScreenshot(setup(), 'component');
    expect(toPng.mock.calls[0][1].backgroundColor).toBeUndefined();
  });
});
