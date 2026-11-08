import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTempRoot, writeProjectMetadata, startTestServer, registerProject, cleanupProjectApiTestRoots } from './projects-api.helpers';
vi.mock('../localPrototypeScreenshots.ts', () => ({ captureLocalPrototype: vi.fn(async (_root: string, requests: Array<{ key: string }>) => requests.map(request => ({ key: request.key, png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==', 'base64') }))) }));
afterEach(() => cleanupProjectApiTestRoots());
it('scopes screenshot previews and replaces an attachment only through a confirmed job', async () => {
  const root = createTempRoot(), docs = createTempRoot(), publish = createTempRoot();
  writeProjectMetadata(root, { project: { id: 'shot-client', name: 'Shots' } });
  fs.mkdirSync(path.join(root, '.axhub/make'), { recursive: true });
  fs.writeFileSync(path.join(root, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: docs, axurePublishDirectory: publish } }));
  fs.writeFileSync(path.join(docs, 'PRD.md'), '![hero](hero.png)'); fs.writeFileSync(path.join(docs, 'hero.png'), 'old');
  fs.writeFileSync(path.join(publish, 'home.html'), '<div data-label="Hero [prd:hero]">Hello</div>');
  const server = await startTestServer(root);
  try {
    await registerProject(server.origin, root, 'shot-client');
    const base = server.origin + '/api/prd-screenshots';
    expect((await fetch(base + '/preview?document=configured-prd%2FPRD.md')).status).toBe(400);
    const plan = await fetch(base + '/preview?projectId=shot-client&document=configured-prd%2FPRD.md').then(r => r.json());
    const post = (action: string, body: unknown) => fetch(base + '/' + action + '?projectId=shot-client', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('capture', { document: plan.document, digest: 'wrong', selections: [{ asset: 'hero.png', page: 'home.html' }] })).status).toBe(400);
    const job = await post('capture', { document: plan.document, digest: plan.digest, selections: [{ asset: 'hero.png', page: 'home.html' }] }).then(r => r.json());
    expect(fs.readFileSync(path.join(docs, 'hero.png'), 'utf8')).toBe('old');
    expect((await fetch(server.origin + job.items[0].previewUrl)).headers.get('content-type')).toContain('image/png');
    expect((await post('apply', { jobId: job.jobId })).status).toBe(200);
    expect(fs.readFileSync(path.join(docs, 'hero.png')).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(fs.readFileSync(path.join(docs, 'PRD.md'), 'utf8')).toBe('![hero](hero.png)');
  } finally { await server.close(); }
});
