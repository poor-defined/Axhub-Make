/** Opt-in live model check; sends only a synthetic snapshot and never writes project files or clipboard. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAxureOrganizationSession } from '../../src/index/domains/export/axureOrganizationSession.ts';
import type { AxureTreePayload } from '../../src/common/axureTreeOrganization.ts';

const origin = process.env.REQ010_ORIGIN || 'http://127.0.0.1:53818';
const projectId = process.env.REQ010_PROJECT_ID;
if (!projectId) throw new Error('Set REQ010_PROJECT_ID to an existing development project ID.');
const rect = (x: number, width: number) => ({ location: { x, y: 0 }, size: { width, height: 40 } });
const payload: AxureTreePayload = { scene: { items: [{ id: 'page', name: '订单操作', itemType: 2, rect: rect(0, 200), scene: { items: [
  { id: 'a', name: 'button', itemType: 1, rect: rect(0, 80), text: { paragraphs: [{ inlines: [{ text: '查询订单' }] }] } },
  { id: 'b', name: 'button', itemType: 1, rect: rect(100, 80), text: { paragraphs: [{ inlines: [{ text: '重置条件' }] }] } },
] } }] } };
let requests = 0;
const session = createAxureOrganizationSession({
  analyze: async (summary, signal, context) => {
    requests++;
    const response = await fetch(`${origin}/api/axure/organize?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, context }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(130_000)]),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body.plan;
  },
  copy: async () => { throw new Error('Smoke must not touch the clipboard'); },
  onChange: (state) => console.log(JSON.stringify({ phase: state.phase, version: state.version || 0 })),
});

async function main() {
  const before = JSON.stringify(payload);
  await session.start(payload);
  assert.equal(requests, 0);
  assert.equal(session.getState().phase, 'captured');
  await session.organize('节点 a 命名为 btn_查询，b 命名为 btn_重置；把 a 和 b 放入一个中文命名的“订单操作”分组。所有按钮保留 btn_ 前缀。');
  let state = session.getState();
  assert.equal(state.phase, 'ready', state.error);
  assert.equal(state.plan?.groups.length, 1);
  assert.equal(state.plan?.renames.find((entry) => entry.id === 'a')?.name, 'btn_查询');
  await session.organize('保留上一轮按钮的 btn_ 前缀；将 a 改名为 btn_搜索订单，把上一轮的分组改名为“查询操作区”。只保留一层分组，不要嵌套旧组。');
  state = session.getState();
  assert.equal(state.phase, 'ready', state.error);
  assert.equal(state.version, 2);
  assert.equal(state.plan?.groups.length, 1);
  assert.equal(state.plan?.groups[0].name, '查询操作区');
  assert.equal(state.plan?.renames.find((entry) => entry.id === 'a')?.name, 'btn_搜索订单');
  assert.ok(state.plan?.renames.find((entry) => entry.id === 'b')?.name.startsWith('btn_'));
  assert.deepEqual(state.original, payload);
  assert.equal(JSON.stringify(payload), before);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-req010-refinement-'));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ requests, state }, null, 2));
  console.log(JSON.stringify({ result: 'passed', requests, report: path.join(dir, 'result.json') }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
