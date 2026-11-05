import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runAcpChatCommand } from './acpChatRunner';
import { getAssistantWorkRuntime, stopAssistantWorkRuntimes } from './assistantWorkRuntime';
import { PROTOTYPE_WIREFRAME_POLICY } from '../common/prototypeWireframePolicy';

vi.mock('./acpChatRunner', () => ({ runAcpChatCommand: vi.fn() }));
let projectRoot = '';
afterEach(async () => {
  await stopAssistantWorkRuntimes();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

it('applies wireframe rules to canvas/voice work at the ACP boundary while preserving MCP-only constraints', async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wireframe-canvas-work-'));
  vi.mocked(runAcpChatCommand).mockResolvedValue({ output: 'done', errors: [], toolOutputs: [] } as any);
  const runtime = getAssistantWorkRuntime({ projectRoot, projectId: 'wireframe-test', acpApiBaseUrl: 'http://acp.test/api', mcpUrl: 'http://make.test/mcp' });
  await runtime.ready;
  const work = await runtime.store.create({ resourcePath: 'flows/home.excalidraw', operationId: 'create', objective: '新增订单查询界面', baseRevision: 'r1' });
  await runtime.dispatcher.start(work);
  await vi.waitFor(() => expect(runAcpChatCommand).toHaveBeenCalled());
  const request = vi.mocked(runAcpChatCommand).mock.calls[0][0];
  expect(request.prompt).toContain(PROTOTYPE_WIREFRAME_POLICY);
  expect(request.prompt).toContain('新增订单查询界面');
  expect(request.system).toContain(PROTOTYPE_WIREFRAME_POLICY);
  expect(request.system).toContain('Never write files directly.');
  expect(request.system).toContain('revision before every mutation');
  expect(request.mcpServers?.[0]).toMatchObject({ name: 'axhub-canvas' });
});
