import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleComponentDocumentationApi } from '../managementApi.componentDocumentation';
import { runAcpChat } from '../acpChatRunner';
import { resolveAssistantRuntime } from '../assistantRuntime';
vi.mock('../acpChatRunner', async (original) => ({
  ...(await original<typeof import('../acpChatRunner')>()),
  runAcpChat: vi.fn(),
}));
vi.mock('../assistantRuntime', () => ({ resolveAssistantRuntime: vi.fn() }));
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const capture = {
  imageDataUrl: png,
  note: '',
  component: { name: '查询组件', selector: '#search', text: '查询订单' },
  source: { title: '订单页', url: 'http://localhost:51720/prototypes/orders' },
};
let root: string;
async function request(
  endpoint: string,
  body?: unknown,
  authorized = true,
  onResponse?: (response: EventEmitter) => void,
) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage;
  req.method = body === undefined ? 'GET' : 'POST';
  req.url = `${endpoint}?projectId=test`;
  req.headers = { host: 'localhost:53818' };
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = vi.fn();
  res.writableEnded = false;
  let finish!: (value: { status: number; body: any }) => void;
  const result = new Promise<{ status: number; body: any }>((resolve) => {
    finish = resolve;
  });
  res.end = (text: string) => {
    res.writableEnded = true;
    finish({ status: res.statusCode, body: JSON.parse(text) });
  };
  onResponse?.(res);
  expect(
    handleComponentDocumentationApi(req, res as ServerResponse, {} as any, endpoint, {
      resolveProjectContext: (_req, response) => {
        if (!authorized) {
          response.statusCode = 400;
          response.end('{"error":"project required"}');
          return null;
        }
        return { project: { id: 'test', root } };
      },
      getServerConfigStoreForRequest: () => ({
        getConfig: () => ({
          automation: { conversationPromptClient: 'acp:codex', conversationModel: 'test' },
        }),
      }),
    }),
  ).toBe(true);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-doc-test-'));
  fs.mkdirSync(path.join(root, 'src/resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/resources/PRD.md'), '# 原需求\n\n保持原文。\n');
  vi.mocked(resolveAssistantRuntime).mockResolvedValue({
    apiBaseUrl: 'http://acp/api',
    health: { status: 'ready' },
  } as any);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        cancelled: true,
        capabilitySnapshot: {
          capabilities: { mode: { source: 'agent', options: [{ value: 'read-only' }] } },
        },
      }),
    ),
  );
  vi.mocked(runAcpChat).mockResolvedValue({
    output: JSON.stringify({
      title: '订单查询',
      description: '点击查询订单。\n\n### 待确认\n查询权限。',
    }),
    toolOutputs: [],
    errors: [],
    runtimeHeaders: { modeId: 'read-only', warningCount: 0 },
  } as any);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});
describe('component documentation', () => {
  it('lists only existing Markdown documents in project resources', async () => {
    fs.writeFileSync(path.join(root, 'secret.md'), 'not a project document');
    fs.writeFileSync(path.join(root, 'src/resources/image.svg'), '<svg/>');
    expect(await request('/api/component-documentation/documents')).toMatchObject({
      status: 200,
      body: { documents: [{ path: 'src/resources/PRD.md', title: '原需求' }] },
    });
  });
  it('analyzes actual screenshot and allows empty note in isolated readonly mode', async () => {
    expect(
      (
        await request('/api/component-documentation/generate', {
          capture,
          instruction: '用中文',
          previousDescription: '旧说明',
        })
      ).status,
    ).toBe(200);
    const input = vi.mocked(runAcpChat).mock.calls[0][0];
    expect(input.workspacePath).not.toBe(root);
    expect(input.modeId).toBe('read-only');
    expect(input.tools).toEqual({});
    expect(input.messages[0].parts).toContainEqual({
      type: 'file',
      mediaType: 'image/png',
      url: png,
    });
    expect(JSON.stringify(input.messages)).toContain('用中文');
    expect(JSON.stringify(input.messages)).toContain('旧说明');
    expect(input.system).toContain('待确认');
    expect(input.system).toContain('不得修改原型');
  });
  it('appends confirmed image and edited description, preserving previous text and repeated imports', async () => {
    const body = {
      capture,
      documentPath: 'src/resources/PRD.md',
      title: '查询组件',
      description: '用户编辑后的说明',
    };
    const result = await request('/api/component-documentation/append', body);
    expect(result.status).toBe(200);
    const asset = result.body.assetPath;
    expect(fs.readFileSync(path.join(root, asset))).toEqual(
      Buffer.from(png.split(',')[1], 'base64'),
    );
    const first = fs.readFileSync(path.join(root, body.documentPath), 'utf8');
    expect(first.startsWith('# 原需求\n\n保持原文。\n')).toBe(true);
    expect(first).toContain('用户编辑后的说明');
    expect(first).toContain('订单页');
    expect(first).toContain('#search');
    expect(first).toMatch(/!\[查询组件\]\(assets\/component-/u);
    expect((await request('/api/component-documentation/append', body)).status).toBe(200);
    expect(fs.readFileSync(path.join(root, body.documentPath), 'utf8').startsWith(first)).toBe(
      true,
    );
    expect(runAcpChat).not.toHaveBeenCalled();
  });
  it.each([
    '../outside.md',
    '/tmp/outside.md',
    '.axhub/private.md',
    'src/resources/missing.md',
    'secret.md',
  ])('rejects invalid document %s without assets or writes', async (documentPath) => {
    expect(
      (
        await request('/api/component-documentation/append', {
          capture,
          documentPath,
          title: 'test',
          description: 'test',
        })
      ).status,
    ).toBe(403);
    expect(fs.existsSync(path.join(root, 'src/resources/assets'))).toBe(false);
  });
  it('rejects escaped document and asset symlinks', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-doc-'));
    try {
      fs.writeFileSync(path.join(outside, 'prd.md'), 'keep');
      fs.symlinkSync(path.join(outside, 'prd.md'), path.join(root, 'src/resources/linked.md'));
      expect(
        (
          await request('/api/component-documentation/append', {
            capture,
            documentPath: 'src/resources/linked.md',
            title: 'x',
            description: 'y',
          })
        ).status,
      ).toBe(403);
      fs.symlinkSync(outside, path.join(root, 'src/resources/assets'));
      expect(
        (
          await request('/api/component-documentation/append', {
            capture,
            documentPath: 'src/resources/PRD.md',
            title: 'x',
            description: 'y',
          })
        ).status,
      ).toBe(403);
      expect(fs.readdirSync(outside)).toEqual(['prd.md']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it.each([
    { ...capture, imageDataUrl: 'data:image/png;base64,bm90LXBuZw==' },
    { ...capture, imageDataUrl: 'https://example.com/image.png' },
    { ...capture, note: 'x'.repeat(8001) },
  ])('rejects invalid capture before AI', async (invalid) => {
    expect(
      (await request('/api/component-documentation/generate', { capture: invalid })).status,
    ).toBe(400);
    expect(runAcpChat).not.toHaveBeenCalled();
  });
  it('requires project scope and a verified readonly runtime', async () => {
    expect(
      (await request('/api/component-documentation/generate', { capture }, false)).status,
    ).toBe(400);
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        capabilitySnapshot: {
          capabilities: { mode: { source: 'fallback', options: [{ value: 'read-only' }] } },
        },
      }),
    );
    expect((await request('/api/component-documentation/generate', { capture })).status).toBe(503);
    expect(runAcpChat).not.toHaveBeenCalled();
  });
  it('rejects malformed AI output, tool use, or unconfirmed modes without writing docs', async () => {
    for (const result of [
      { output: 'not json', toolOutputs: [], errors: [], runtimeHeaders: { modeId: 'read-only' } },
      {
        output: '{"title":"x","description":"y"}',
        toolOutputs: [{}],
        errors: [],
        runtimeHeaders: { modeId: 'read-only' },
      },
      {
        output: '{"title":"x","description":"y"}',
        toolOutputs: [],
        errors: [],
        runtimeHeaders: { modeId: 'bypassPermissions' },
      },
    ]) {
      vi.mocked(runAcpChat).mockResolvedValue(result as any);
      expect((await request('/api/component-documentation/generate', { capture })).status).toBe(
        502,
      );
    }
    expect(fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8')).toBe(
      '# 原需求\n\n保持原文。\n',
    );
  });
  it('keeps document and removes orphan image if the atomic document write fails', async () => {
    const before = fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('write denied');
    });
    try {
      expect(
        (
          await request('/api/component-documentation/append', {
            capture,
            documentPath: 'src/resources/PRD.md',
            title: '组件',
            description: '说明',
          })
        ).status,
      ).toBe(400);
      expect(fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8')).toBe(before);
      expect(fs.readdirSync(path.join(root, 'src/resources/assets'))).toEqual([]);
      expect(
        fs.readdirSync(path.join(root, 'src/resources')).some((name) => name.endsWith('.tmp')),
      ).toBe(false);
    } finally {
      rename.mockRestore();
    }
  });
  it('serializes concurrent confirmations so neither appended section is lost', async () => {
    const results = await Promise.all(
      ['组件一', '组件二'].map((title) =>
        request('/api/component-documentation/append', {
          capture,
          documentPath: 'src/resources/PRD.md',
          title,
          description: '说明',
        }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const content = fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8');
    expect(content).toContain('## 组件一');
    expect(content).toContain('## 组件二');
    expect(fs.readdirSync(path.join(root, 'src/resources/assets'))).toHaveLength(2);
  });
  it('cancels the same ACP thread and cleans isolated files on client disconnect', async () => {
    let response!: EventEmitter;
    vi.mocked(runAcpChat).mockImplementation(
      async (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const pending = request('/api/component-documentation/generate', { capture }, true, (res) => {
      response = res;
    });
    await vi.waitFor(() => expect(runAcpChat).toHaveBeenCalledTimes(1));
    response.emit('close');
    expect((await pending).status).toBe(504);
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('http://acp/api/chat/cancel', expect.anything()),
    );
    const input = vi.mocked(runAcpChat).mock.calls[0][0];
    const cancelled = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/chat/cancel'))!;
    expect(JSON.parse(String(cancelled[1]?.body))).toMatchObject({
      threadId: input.threadId,
      workspacePath: input.workspacePath,
    });
    expect(JSON.parse(String(cancelled[1]?.body))).not.toHaveProperty('apiBaseUrl');
    await vi.waitFor(() => expect(fs.existsSync(input.workspacePath!)).toBe(false));
  });
  it('retains original component identity when the generated title is edited and no selector is available', async () => {
    const originalCapture = {
      ...capture,
      note: '',
      component: { name: '原始登录面板', text: '登录' },
    };
    const result = await request('/api/component-documentation/append', {
      capture: originalCapture,
      documentPath: 'src/resources/PRD.md',
      title: '重新编辑的章节名',
      description: '组件说明',
    });
    expect(result.status).toBe(200);
    const content = fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8');
    expect(content).toContain('## 重新编辑的章节名');
    expect(content).toContain('组件：原始登录面板');
    expect(content).toContain(originalCapture.source.url);
  });

  it('accepts the verified Codex startup diagnostic without treating valid AI JSON as a failure', async () => {
    const diagnostic =
      'Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';
    vi.mocked(runAcpChat).mockResolvedValue({
      output: `${diagnostic}\n\n{"title":"查询组件","description":"查询订单。业务规则待确认。"}`,
      toolOutputs: [],
      errors: [],
      runtimeHeaders: { modeId: 'read-only', warningCount: 0 },
    } as any);
    expect(await request('/api/component-documentation/generate', { capture })).toMatchObject({
      status: 200,
      body: { title: '查询组件', description: '查询订单。业务规则待确认。' },
    });
  });
});
