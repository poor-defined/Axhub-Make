import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAcpChat } from '../acpChatRunner';
import { resolveAssistantRuntime } from '../assistantRuntime';
import {
  cleanupProjectApiTestRoots,
  createTempRoot,
  registerProject,
  startTestServer,
  writeProjectMetadata,
} from './projects-api.helpers';
vi.mock('../acpChatRunner', async (original) => ({
  ...(await original<typeof import('../acpChatRunner')>()),
  runAcpChat: vi.fn(),
}));
vi.mock('../assistantRuntime', async (original) => ({
  ...(await original<typeof import('../assistantRuntime')>()),
  resolveAssistantRuntime: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanupProjectApiTestRoots();
});
const imageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const capture = {
  imageDataUrl,
  note: '',
  component: { name: '查询组件', selector: '#search', text: '查询订单' },
  source: { title: '订单页', url: 'http://localhost:51720/prototypes/orders' },
};
describe('component documentation through Make HTTP server', () => {
  it('scopes, generates with image, appends confirmed content, and serves the resulting Markdown asset', async () => {
    const root = createTempRoot('axhub-documentation-http-');
    writeProjectMetadata(root, {
      project: { id: 'docs-test', name: 'Docs test' },
      resources: { prototypes: [], docs: [], themes: [], data: [], templates: [] },
    });
    fs.mkdirSync(path.join(root, 'src/resources'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/resources/PRD.md'), '# 既有需求\n');
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input).startsWith('http://acp.test/api/'))
          return Response.json({
            cancelled: true,
            capabilitySnapshot: {
              capabilities: {
                mode: { source: 'session_modes', options: [{ value: 'read-only' }] },
              },
            },
          });
        return realFetch(input, init);
      }),
    );
    vi.mocked(resolveAssistantRuntime).mockResolvedValue({
      apiBaseUrl: 'http://acp.test/api',
      health: { status: 'ready' },
    } as any);
    vi.mocked(runAcpChat).mockResolvedValue({
      output: JSON.stringify({
        title: '查询组件说明',
        description: '展示订单查询。\n\n### 待确认\n权限规则。',
      }),
      toolOutputs: [],
      errors: [],
      runtimeHeaders: { modeId: 'read-only', warningCount: 0 },
    } as any);
    const server = await startTestServer(root);
    try {
      await registerProject(server.origin, root, 'docs-test');
      const post = (operation: string, body: unknown, scoped = true) =>
        fetch(
          `${server.origin}/api/component-documentation/${operation}${scoped ? '?projectId=docs-test' : ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
      expect((await post('generate', { capture }, false)).status).toBe(400);
      expect(runAcpChat).not.toHaveBeenCalled();
      const documents = await fetch(
        `${server.origin}/api/component-documentation/documents?projectId=docs-test`,
      );
      expect(documents.status).toBe(200);
      expect((await documents.json()).documents).toContainEqual({
        path: 'src/resources/PRD.md',
        title: '既有需求',
      });
      const generated = await post('generate', { capture });
      expect(generated.status).toBe(200);
      const draft = await generated.json();
      expect(vi.mocked(runAcpChat).mock.calls[0][0].messages[0].parts).toContainEqual({
        type: 'file',
        mediaType: 'image/png',
        url: imageDataUrl,
      });
      expect(fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8')).toBe('# 既有需求\n');
      const appended = await post('append', {
        capture,
        documentPath: 'src/resources/PRD.md',
        ...draft,
      });
      expect(appended.status).toBe(200);
      const result = await appended.json();
      const asset = path.relative('src/resources', result.assetPath).split(path.sep).join('/');
      const response = await fetch(
        `${server.origin}/api/projects/docs-test/document-asset?path=src%2Fresources%2FPRD.md&asset=${encodeURIComponent(asset)}`,
      );
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        Buffer.from(imageDataUrl.split(',')[1], 'base64'),
      );
      expect(fs.readFileSync(path.join(root, 'src/resources/PRD.md'), 'utf8')).toContain(
        '![查询组件说明](assets/component-',
      );
      const oversized = await post('generate', { capture, padding: 'x'.repeat(13 * 1024 * 1024) });
      expect(oversized.status).toBe(413);
    } finally {
      await server.close();
    }
  });
});
