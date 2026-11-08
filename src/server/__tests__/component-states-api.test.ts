import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupProjectApiTestRoots, createTempRoot, writeProjectMetadata, startTestServer, registerProject } from './projects-api.helpers';
afterEach(cleanupProjectApiTestRoots);
it('creates only a new scoped prototype with source context and an executable main specification', async () => {
  const root = createTempRoot(); writeProjectMetadata(root, { project: { id: 'states-test', name: 'States' } });
  const server = await startTestServer(root);
  try {
    await registerProject(server.origin, root, 'states-test');
    const source = path.join(root, 'source.html'); fs.writeFileSync(source, '<header>original</header>');
    const body = { requestId: '718dd9a9-a16d-4631-a5c4-52d6ae37dd4c', title: 'Header 状态说明', layout: 'overview', sourceHtml: '<header>original</header>', capture: { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==', note: '展示未登录、已登录', component: { name: 'Header [prd:cfd-f01-header]' }, source: { title: '来源页', url: 'http://localhost:51720/' } } };
    const response = await fetch(`${server.origin}/api/prototypes/create-component-states?projectId=states-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.name).toMatch(/^component-states-/);
    const generated = '// Existing generated source must survive a retried preparation request';
    fs.writeFileSync(created.absoluteFilePath, generated);
    const repeated = await fetch(`${server.origin}/api/prototypes/create-component-states?projectId=states-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    expect(repeated.name).toBe(created.name);
    expect(fs.readFileSync(created.absoluteFilePath, 'utf8')).toBe(generated);
    const conflict = await fetch(`${server.origin}/api/prototypes/create-component-states?projectId=states-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, title: 'Different' }) });
    expect(conflict.status).toBe(400);
    expect(fs.readFileSync(created.absoluteFilePath, 'utf8')).toBe(generated);
    expect(created.prompt).toContain('cfd-f01-header-part-');
    const spec = await fetch(`${server.origin}/api/projects/states-test/prototypes/${created.name}/spec`).then(r => r.json());
    expect(spec.activePath).toBe('spec.md');
    expect(fs.readFileSync(source, 'utf8')).toBe('<header>original</header>');
    expect(fs.readFileSync(path.join(path.dirname(created.absoluteFilePath), '.spec/spec.md'), 'utf8')).toContain(body.capture.note);
    expect(fs.existsSync(path.join(path.dirname(created.absoluteFilePath), 'assets/source-component.png'))).toBe(true);
    expect((await fetch(`${server.origin}/api/prototypes/create-component-states?projectId=states-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, capture: { ...body.capture, note: '' } }) })).status).toBe(400);
  } finally { await server.close(); }
});
