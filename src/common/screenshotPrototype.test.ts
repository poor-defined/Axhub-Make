import { describe, expect, it } from 'vitest';
import { buildScreenshotPrototypePrompt, validateScreenshotPrototypeRequest } from './screenshotPrototype';

export const screenshotPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==';
const input = () => ({ title: '首页', instructions: '保留中文文案', images: [{ name: '首页.png', dataUrl: screenshotPng }] });
describe('screenshot prototype request', () => {
  it('accepts a screenshot without extra instructions and supplies a default title', () => {
    expect(validateScreenshotPrototypeRequest({ images: input().images })).toMatchObject({ title: '截图线框原型', instructions: '', images: input().images });
  });
  it('requires 1–3 supported images and bounded, valid base64 content', () => {
    for (const images of [[], Array(4).fill(input().images[0]), [{ name: 'x', dataUrl: 'https://example.com/a.png' }], [{ name: 'x', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }], [{ name: 'x', dataUrl: 'data:image/png;base64,@@@' }], [{ name: 'x', dataUrl: `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}` }]]) {
      expect(() => validateScreenshotPrototypeRequest({ ...input(), images })).toThrow();
    }
    expect(() => validateScreenshotPrototypeRequest({ ...input(), requestId: '../../other' })).toThrow();
    expect(() => validateScreenshotPrototypeRequest({ ...input(), instructions: 'a'.repeat(6001) })).toThrow();
  });
  it('builds an editable wireframe brief without embedding image bytes in the text prompt', () => {
    const prompt = buildScreenshotPrototypePrompt(validateScreenshotPrototypeRequest(input()));
    expect(prompt).toContain('保留中文文案');
    expect(prompt).toContain('真实 DOM');
    expect(prompt).toContain('黑白灰');
    expect(prompt).toContain('待确认');
    expect(prompt).not.toContain(screenshotPng);
  });
});
