import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAxureTreeOrganizationApi } from '../managementApi.axureTreeOrganization';
import { runAcpChatCommand } from '../acpChatRunner';
import { resolveAssistantRuntime } from '../assistantRuntime';

vi.mock('../acpChatRunner', async (original) => ({ ...await original<typeof import('../acpChatRunner')>(), runAcpChatCommand: vi.fn() }));
vi.mock('../assistantRuntime', () => ({ resolveAssistantRuntime: vi.fn() }));

const summary = {
  version: 1,
  nodes: [
    { id: 'page', name: '订单', itemType: 2, parentId: null, order: 0, canGroupChildren: true },
    { id: 'a', name: 'div', itemType: 1, parentId: 'page', order: 0, canGroupChildren: false },
    { id: 'b', name: 'div', itemType: 1, parentId: 'page', order: 1, canGroupChildren: false },
  ].map((node) => ({ ...node, text: '搜索订单', rect: { location: { x: 10, y: 10 }, size: { width: 80, height: 40 } } })),
};
const plan = { version: 1, renames: [{ id: 'a', name: '查询按钮' }], groups: [{ id: 'ai-group-search', parentId: 'page', name: '查询区', childIds: ['a', 'b'] }] };

async function request(body: unknown, authorized = true, onResponse?: (res: EventEmitter) => void) {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  req.method = 'POST'; req.url = '/api/axure/organize?projectId=test'; req.headers = { host: 'localhost:53818' };
  const res: any = new EventEmitter();
  res.statusCode = 200; res.setHeader = vi.fn(); res.writableEnded = false;
  let finish!: (result: { status: number; body: any }) => void;
  const result = new Promise<{ status: number; body: any }>((resolve) => { finish = resolve; });
  res.end = (text: string) => { res.writableEnded = true; finish({ status: res.statusCode, body: JSON.parse(text) }); };
  onResponse?.(res);
  const resolveProjectContext = vi.fn((_req, response) => {
    if (!authorized) { response.statusCode = 400; response.end(JSON.stringify({ error: 'Project scope required' })); return null; }
    return { project: { id: 'test', root: '/test-project' } };
  });
  const handled = handleAxureTreeOrganizationApi(req, res as ServerResponse, {} as any, '/api/axure/organize', {
    resolveProjectContext,
    getServerConfigStoreForRequest: () => ({ getConfig: () => ({ automation: { conversationPromptClient: 'acp:claude', conversationModel: 'test-model' }, assistant: {} }) }),
  });
  expect(handled).toBe(true);
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveAssistantRuntime).mockResolvedValue({ apiBaseUrl: 'http://acp/api', health: { status: 'ready' } } as any);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    cancelled: true,
    capabilitySnapshot: { capabilities: { mode: { source: 'agent', options: [{ value: 'plan' }, { value: 'read-only' }] } } },
  })));
  vi.mocked(runAcpChatCommand).mockResolvedValue({ output: JSON.stringify(plan), toolOutputs: [], errors: [], runtimeHeaders: { modeId: 'plan', warningCount: 0 } } as any);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Axure tree organization API', () => {
  it('uses configured AI in plan mode and returns a validated operation plan', async () => {
    const result = await request({ summary });
    expect(result).toMatchObject({ status: 200, body: { plan } });
    const [input, options] = vi.mocked(runAcpChatCommand).mock.calls[0];
    expect(input).toMatchObject({ provider: 'claude', model: 'test-model', modeId: 'plan', permissionMode: 'plan', mcpServers: [], builtinTools: [], tools: {} });
    expect(input.workspacePath).not.toBe('/test-project');
    expect(input.prompt).toContain('搜索订单');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('requires explicit project scope without invoking AI', async () => {
    expect((await request({ summary }, false)).status).toBe(400);
    expect(runAcpChatCommand).not.toHaveBeenCalled();
  });
  it('rejects malformed or oversized summaries before invoking AI', async () => {
    expect((await request({ summary: { ...summary, imageMap: { secret: 'not allowed' } } })).status).toBe(400);
    expect((await request({ summary, extra: 'x'.repeat(700_000) })).status).toBe(413);
    expect(runAcpChatCommand).not.toHaveBeenCalled();
  });
  it('rejects hallucinated IDs and code/prose rather than returning an unsafe plan', async () => {
    vi.mocked(runAcpChatCommand).mockResolvedValue({ output: JSON.stringify({ ...plan, renames: [{ id: 'ghost', name: '错误' }] }), toolOutputs: [], errors: [] } as any);
    expect((await request({ summary })).status).toBe(502);
    vi.mocked(runAcpChatCommand).mockResolvedValue({ output: 'run code instead', toolOutputs: [], errors: [] } as any);
    expect((await request({ summary })).status).toBe(502);
  });
  it('reports unavailable runtime and model failure without copying or silently falling back', async () => {
    vi.mocked(resolveAssistantRuntime).mockResolvedValue({ health: { status: 'runtime_unreachable' } } as any);
    expect((await request({ summary })).status).toBe(503);
    vi.mocked(resolveAssistantRuntime).mockResolvedValue({ apiBaseUrl: 'http://acp/api', health: { status: 'ready' } } as any);
    vi.mocked(runAcpChatCommand).mockRejectedValue(new Error('model failed'));
    expect((await request({ summary })).status).toBe(502);
  });
  it('does not prompt the model if its read-only mode is not advertised by the runtime', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ capabilitySnapshot: { capabilities: { mode: { source: 'fallback', options: [{ value: 'plan' }] } } } }));
    expect((await request({ summary })).status).toBe(503);
    expect(runAcpChatCommand).not.toHaveBeenCalled();
  });
  it.each([
    { modeId: 'bypassPermissions', warningCount: 0 },
    { modeId: undefined, warningCount: 0 },
    { modeId: 'plan', warningCount: 1 },
  ])('does not accept output with unconfirmed runtime mode: %j', async (runtimeHeaders) => {
    vi.mocked(runAcpChatCommand).mockResolvedValue({ output: JSON.stringify(plan), toolOutputs: [], errors: [], runtimeHeaders } as any);
    expect((await request({ summary })).status).toBe(502);
  });
  it('explicitly cancels the same ACP thread when the client disconnects', async () => {
    let response!: EventEmitter;
    vi.mocked(runAcpChatCommand).mockImplementation(async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = request({ summary }, true, (res) => { response = res; });
    await vi.waitFor(() => expect(runAcpChatCommand).toHaveBeenCalledTimes(1));
    response.emit('close');
    await pending;
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('http://acp/api/chat/cancel', expect.anything()));
    const cancelCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/chat/cancel'))!;
    const body = JSON.parse(String(cancelCall[1]?.body));
    expect(body.threadId).toBe(vi.mocked(runAcpChatCommand).mock.calls[0][0].threadId);
  });
  it('times out independently and sends cancellation to ACP', async () => {
    vi.useFakeTimers();
    vi.mocked(runAcpChatCommand).mockImplementation(async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
    }));
    const pending = request({ summary });
    await vi.waitFor(() => expect(runAcpChatCommand).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(120_001);
    expect((await pending).status).toBe(504);
    expect(fetch).toHaveBeenCalledWith('http://acp/api/chat/cancel', expect.anything());
  });
});
