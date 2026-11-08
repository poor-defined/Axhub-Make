import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenshotPrototypeComposer } from './ScreenshotPrototypeComposer';
let view: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => view?.unmount()); });
it('requires an image, exposes paste/upload instructions and shows recoverable errors without discarding the screenshot', async () => {
  const state = { phase: 'idle' as const, projectId: '', request: null, prepared: null, error: '', message: '' };
  const controller = { state, generate: vi.fn(), retry: vi.fn(), reset: vi.fn(), openPrototype: vi.fn() };
  await act(async () => { view = create(React.createElement(ScreenshotPrototypeComposer, { controller })); });
  expect(view!.root.findByProps({ 'aria-label': '生成截图原型' }).props.disabled).toBe(true);
  expect(JSON.stringify(view!.toJSON())).toContain('粘贴截图');
  await act(async () => view!.update(React.createElement(ScreenshotPrototypeComposer, { controller: { ...controller, state: { ...state, phase: 'error', error: 'AI 断开', request: { title: '首页', instructions: '', images: [{ name: 'home.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }] } } } })));
  expect(view!.root.findByType('img').props.alt).toContain('home.png');
  const retry = view!.root.findAllByType('button').find(button => button.children.includes('重试'))!;
  await act(async () => retry.props.onClick()); expect(controller.retry).toHaveBeenCalledOnce();
  expect(JSON.stringify(view!.toJSON())).toContain('AI 断开');
});
it('shows a page-shaped loading state and locks submission while generating', async () => {
  const controller = { state: { phase: 'running' as const, projectId: 'a', request: null, prepared: null, error: '', message: '识别截图' }, generate: vi.fn(), retry: vi.fn(), reset: vi.fn(), openPrototype: vi.fn() };
  await act(async () => { view = create(React.createElement(ScreenshotPrototypeComposer, { controller })); });
  expect(JSON.stringify(view!.toJSON())).toContain('识别截图');
  expect(view!.root.findByProps({ 'aria-label': '生成截图原型' }).props.disabled).toBe(true);
  expect(view!.root.findByProps({ 'data-screenshot-prototype-composer': true }).props['aria-busy']).toBe(true);
});
