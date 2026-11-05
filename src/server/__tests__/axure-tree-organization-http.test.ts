import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAcpChatCommand } from '../acpChatRunner';
import { resolveAssistantRuntime } from '../assistantRuntime';
import { cleanupProjectApiTestRoots, createTempRoot, registerProject, startTestServer, writeProjectMetadata } from './projects-api.helpers';

vi.mock('../acpChatRunner', async (original) => ({ ...await original<typeof import('../acpChatRunner')>(), runAcpChatCommand: vi.fn() }));
vi.mock('../assistantRuntime', async (original) => ({ ...await original<typeof import('../assistantRuntime')>(), resolveAssistantRuntime: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); cleanupProjectApiTestRoots(); });

describe('Axure tree organization through the Make HTTP server', () => {
  it('enforces project scope, delivers plans, handles oversized bodies and cancels provider work', async () => {
    const root = createTempRoot('axhub-tree-http-');
    writeProjectMetadata(root, { project: { id: 'tree-test', name: 'Tree test' }, resources: {
      prototypes: [], docs: [], themes: [], data: [], templates: [],
    } });
    const realFetch = globalThis.fetch;
    const remoteCalls: Array<{ url: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://acp.test/api/')) {
        remoteCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return Response.json({ cancelled: true, capabilitySnapshot: { capabilities: { mode: {
          source: 'session_modes', options: [{ value: 'read-only' }],
        } } } });
      }
      return realFetch(input, init);
    }));
    vi.mocked(resolveAssistantRuntime).mockResolvedValue({ apiBaseUrl: 'http://acp.test/api', health: { status: 'ready' } } as any);
    const plan = { version: 1, renames: [{ id: 'a', name: '查询按钮' }], groups: [] };
    vi.mocked(runAcpChatCommand).mockResolvedValue({ output: JSON.stringify(plan), toolOutputs: [], errors: [], runtimeHeaders: { modeId: 'read-only', warningCount: 0 } } as any);
    const rect = { location: { x: 0, y: 0 }, size: { width: 80, height: 30 } };
    const summary = { version: 1, nodes: [
      { id: 'page', name: '页面', itemType: 2, parentId: null, order: 0, text: '', rect, canGroupChildren: true },
      { id: 'a', name: 'div', itemType: 1, parentId: 'page', order: 0, text: '查询', rect, canGroupChildren: false },
    ] };
    const server = await startTestServer(root);
    try {
      await registerProject(server.origin, root, 'tree-test');
      const post = (suffix: string, body: unknown, signal?: AbortSignal) => fetch(`${server.origin}/api/axure/organize${suffix}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      });
      const unscoped = await post('', { summary });
      expect(unscoped.status).toBe(400);
      expect(runAcpChatCommand).not.toHaveBeenCalled();

      const response = await post('?projectId=tree-test', { summary });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ plan });
      expect(resolveAssistantRuntime).toHaveBeenCalledWith(expect.objectContaining({ projectPath: root }));
      expect(vi.mocked(runAcpChatCommand).mock.calls[0][0]).toMatchObject({ modeId: 'read-only', permissionMode: 'plan' });

      const oversized = await post('?projectId=tree-test', { summary, extra: 'x'.repeat(700_000) });
      expect(oversized.status).toBe(413);
      expect((await oversized.json()).code).toBe('AXURE_ORGANIZATION_FAILED');

      vi.mocked(runAcpChatCommand).mockImplementation(async (_request, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }));
      const controller = new AbortController();
      const pending = post('?projectId=tree-test', { summary }, controller.signal).catch((error) => error);
      await vi.waitFor(() => expect(runAcpChatCommand).toHaveBeenCalledTimes(2));
      const threadId = vi.mocked(runAcpChatCommand).mock.calls[1][0].threadId;
      controller.abort();
      await pending;
      await vi.waitFor(() => expect(remoteCalls).toContainEqual(expect.objectContaining({
        url: 'http://acp.test/api/chat/cancel', body: expect.objectContaining({ threadId }),
      })));
    } finally { await server.close(); }
  });
});
