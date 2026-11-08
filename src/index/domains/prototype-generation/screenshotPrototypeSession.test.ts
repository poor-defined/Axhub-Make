import { expect, it, vi } from 'vitest';
import { createScreenshotPrototypeSession } from './screenshotPrototypeSession';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==';
const request = { title: '首页', instructions: '', images: [{ name: 'home.png', dataUrl: image }] };
const prepared = { name: 'screenshot-one', displayName: '首页', prompt: 'brief', filePath: 'content/prototypes/screenshot-one/index.tsx', clientUrl: '/?p=screenshot-one' };
it('runs with the captured image and reuses its target after failure, never running twice after success', async () => {
  const prepare = vi.fn(async () => prepared), run = vi.fn().mockRejectedValueOnce(new Error('断开')).mockResolvedValue(undefined), onDone = vi.fn();
  const session = createScreenshotPrototypeSession({ prepare, run, onDone });
  expect(prepare).not.toHaveBeenCalled();
  await session.generate('project-a', request);
  expect(session.getState()).toMatchObject({ phase: 'error', error: '断开', prepared });
  await session.retry(); await session.retry();
  expect(prepare).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0][1].images[0].dataUrl).toBe(image);
  expect(onDone).toHaveBeenCalledOnce(); expect(session.getState().phase).toBe('done');
});
it('keeps one request id after a lost creation response and refresh failure does not rerun AI', async () => {
  const prepare = vi.fn().mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValue(prepared), run = vi.fn();
  const session = createScreenshotPrototypeSession({ prepare, run, onDone: async () => { throw new Error('刷新失败'); } });
  await session.generate('p', request); await session.retry(); await session.retry();
  expect(prepare.mock.calls[0][0].requestId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(prepare.mock.calls[1][0].requestId).toBe(prepare.mock.calls[0][0].requestId);
  expect(run).toHaveBeenCalledOnce(); expect(session.getState().phase).toBe('done');
});
it('ignores double clicks and stale work after switching projects', async () => {
  let resolve!: (value: typeof prepared) => void;
  const prepare = vi.fn(() => new Promise<typeof prepared>(r => { resolve = r; })), run = vi.fn(), onDone = vi.fn();
  const session = createScreenshotPrototypeSession({ prepare, run, onDone });
  const first = session.generate('a', request); await session.generate('a', request);
  expect(prepare).toHaveBeenCalledOnce();
  session.reset(); resolve(prepared); await first;
  expect(run).not.toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled(); expect(session.getState().phase).toBe('idle');
});
