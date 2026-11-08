import { expect, it, vi } from 'vitest';
import { createComponentStatesSession } from './componentStatesSession';
const request = { title: 'Header 状态说明', layout: 'overview', capture: { imageDataUrl: 'data:image/png;base64,aGVsbG8=', note: '未登录、已登录', component: { name: 'Header' }, source: { title: 'Home', url: 'http://localhost:51720/' } } };
it('waits for host confirmation and retries in the same new prototype after an AI failure', async () => {
  const prepare = vi.fn(async () => ({ name: 'component-states-one', prompt: 'states', filePath: 'content/prototypes/component-states-one/index.tsx', displayName: 'Header 状态说明', clientUrl: 'http://localhost:51720/?p=component-states-one' }));
  const run = vi.fn().mockRejectedValueOnce(new Error('AI disconnected')).mockResolvedValueOnce(undefined);
  const done = vi.fn();
  const session = createComponentStatesSession({ prepare, run, onDone: done });
  expect(session.open('project-a', request)).toBe(true);
  expect(prepare).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  await session.generate();
  expect(session.getState()).toMatchObject({ phase: 'error', error: 'AI disconnected', prepared: { name: 'component-states-one' } });
  await session.generate();
  expect(prepare).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledTimes(2);
  expect(session.getState().phase).toBe('done'); expect(done).toHaveBeenCalledTimes(1);
});
it('ignores duplicate execution and stale results after switching projects', async () => {
  let resolve!: (value: any) => void;
  const prepare = vi.fn(() => new Promise<any>(r => { resolve = r; }));
  const run = vi.fn(), done = vi.fn();
  const session = createComponentStatesSession({ prepare, run, onDone: done });
  session.open('project-a', request);
  const first = session.generate(); await session.generate();
  expect(prepare).toHaveBeenCalledTimes(1);
  session.reset(); session.open('project-b', request);
  resolve({ name: 'old', prompt: 'old', filePath: 'src/prototypes/old/index.tsx' }); await first;
  expect(run).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  expect(session.getState()).toMatchObject({ projectId: 'project-b', phase: 'review', prepared: null });
});
it('keeps a stable preparation identity when the creation response is lost', async () => {
  const prepare = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ name: 'same', prompt: 'states', filePath: 'src/prototypes/same/index.tsx' });
  const session = createComponentStatesSession({ prepare, run: vi.fn(), onDone: vi.fn() });
  session.open('a', request); await session.generate(); await session.generate();
  const first = prepare.mock.calls[0][0], second = prepare.mock.calls[1][0];
  expect(first.requestId).toMatch(/^[a-f0-9-]{36}$/u);
  expect(second.requestId).toBe(first.requestId);
});
