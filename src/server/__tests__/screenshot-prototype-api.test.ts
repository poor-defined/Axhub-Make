import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupProjectApiTestRoots, createTempRoot, writeProjectMetadata, startTestServer, registerProject } from './projects-api.helpers';
afterEach(cleanupProjectApiTestRoots);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==';
it('prepares an independent screenshot prototype, preserves generated files on retry and rejects conflicts and forged images', async () => {
  const root = createTempRoot(); writeProjectMetadata(root, { project: { id: 'screenshot-test', name: 'Screenshots' } });
  const server = await startTestServer(root);
  try {
    await registerProject(server.origin, root, 'screenshot-test');
    const body = { requestId: '718dd9a9-a16d-4631-a5c4-52d6ae37dd4c', title: '首页 */ 截图', instructions: '保留导航', images: [{ name: '../home.png', dataUrl: png }] };
    const post = (value: unknown) => fetch(`${server.origin}/api/prototypes/create-from-screenshot?projectId=screenshot-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const response = await post(body); expect(response.status).toBe(201);
    const created = await response.json(), directory = path.dirname(created.absoluteFilePath);
    expect(created.name).toBe(`screenshot-prototype-${body.requestId}`);
    expect(fs.existsSync(path.join(directory, 'assets/source-1.png'))).toBe(true);
    expect(fs.readFileSync(path.join(directory, '.spec/spec.md'), 'utf8')).toContain(body.instructions);
    const initial = fs.readFileSync(created.absoluteFilePath, 'utf8'); expect(initial).not.toContain('@name 首页 */');
    fs.writeFileSync(created.absoluteFilePath, '// generated');
    expect((await (await post(body)).json()).name).toBe(created.name);
    expect((await post({ ...body, title: 'changed' })).status).toBe(400);
    expect(fs.readFileSync(created.absoluteFilePath, 'utf8')).toBe('// generated');
    expect(fs.readFileSync(path.join(directory, 'screenshot-prototype.source.json'), 'utf8')).not.toContain('data:image');
    expect((await post({ ...body, requestId: '818dd9a9-a16d-4631-a5c4-52d6ae37dd4c', images: [{ name: 'fake.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }] })).status).toBe(400);
    expect(fs.existsSync(path.join(path.dirname(directory), 'screenshot-prototype-818dd9a9-a16d-4631-a5c4-52d6ae37dd4c'))).toBe(false);
    const spec = await fetch(`${server.origin}/api/projects/screenshot-test/prototypes/${created.name}/spec`).then(r => r.json()); expect(spec.activePath).toBe('spec.md');
  } finally { await server.close(); }
});
