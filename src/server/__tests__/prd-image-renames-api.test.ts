import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupProjectApiTestRoots, createTempRoot, writeProjectMetadata, startTestServer, registerProject } from './projects-api.helpers';
afterEach(() => cleanupProjectApiTestRoots());
it('requires project scope and an up-to-date preview digest before modifying configured PRD files', async () => {
  const project = createTempRoot(), docs = createTempRoot();
  writeProjectMetadata(project, { project: { id: 'rename-client', name: 'Renames' } });
  fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
  const document = path.join(docs, 'CFD PRD.md');
  fs.writeFileSync(document, '| F02 | 首屏 | ![old](image.png) |');
  fs.writeFileSync(path.join(docs, 'image.png'), 'image');
  fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: document } }));
  const server = await startTestServer(project);
  try {
    await registerProject(server.origin, project, 'rename-client');
    expect((await fetch(`${server.origin}/api/prd-images/preview`)).status).toBe(400);
    const preview = await fetch(`${server.origin}/api/prd-images/preview?projectId=rename-client`).then(r => r.json());
    expect(preview.items).toHaveLength(1);
    expect(fs.existsSync(path.join(docs, 'image.png'))).toBe(true);
    const post = (digest: string) => fetch(`${server.origin}/api/prd-images/apply?projectId=rename-client`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digest }) });
    expect((await post('wrong')).status).toBe(400);
    const applied = await post(preview.digest);
    expect(applied.status).toBe(200);
    expect((await applied.json()).backupDirectory).toBeTruthy();
    expect(fs.readFileSync(document, 'utf8')).toContain('cfd-f02-hero.png');
  } finally { await server.close(); }
});
