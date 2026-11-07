import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { handleReferencePagesApi } from '../managementApi.referencePages.ts';
import { importReferencePage, listReferencePages } from '../referencePages.ts';
import { handleDocumentCommentsApi } from '../managementApi.documentComments.ts';
import { getRequestUrl, sendJson } from '../http.ts';
let server: Server;
let base: string;
let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-http-'));
  server = createServer((req, res) => {
    const handlers: any = {
      resolveProjectContext: (request: any, response: any) => {
        if (getRequestUrl(request).searchParams.get('projectId') !== 'p') {
          sendJson(response, { error: 'Project required' }, { status: 400 });
          return null;
        }
        return { project: { id: 'p', root } };
      },
      readMultipartParts: async () => [],
    };
    if (getRequestUrl(req).pathname === '/api/document-comments') {
      handleDocumentCommentsApi(req, res, { project: { root } }, getRequestUrl(req));
      return;
    }
    if (!handleReferencePagesApi(req, res, {} as any, getRequestUrl(req).pathname, handlers))
      sendJson(res, { error: 'Not found' }, { status: 404 });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
describe('reference HTTP serving', () => {
  it('keeps project scope on relative styles/scripts/images and injects only HTML bootstrap', async () => {
    const page = await importReferencePage(root, {
      filename: 'demo.zip',
      data: Buffer.from(
        zipSync({
          'pages/index.html': strToU8(
            '<link rel="stylesheet" href="style.css"><script src="app.js"></script><img src="a.png">',
          ),
          'pages/style.css': strToU8('body{color:red}'),
          'pages/app.js': strToU8('window.ready=true'),
          'pages/a.png': new Uint8Array([1, 2, 3]),
        }),
      ),
    });
    const url = `${base}/api/projects/p/reference-pages/${page.id}/files/pages/index.html`;
    const html = await fetch(url, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(200);
    const csp = html.headers.get('content-security-policy') || '';
    expect(csp).toContain('sandbox allow-scripts;');
    expect(csp).not.toContain('allow-same-origin');
    const scriptPolicy =
      csp.split(';').find((value) => value.trim().startsWith('script-src')) || '';
    expect(scriptPolicy).not.toContain("'self'");
    expect(scriptPolicy).toContain(`${base}/api/projects/p/reference-pages/${page.id}/files/`);
    expect(scriptPolicy).toContain(`${base}/assets/`);
    expect(scriptPolicy).not.toContain('/@fs/');
    expect(scriptPolicy).not.toContain('/src/');
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain(`${base}/api/projects/p/reference-pages/${page.id}/files/`);
    expect(html.headers.get('access-control-allow-origin')).toBe('*');
    expect(await html.text()).toContain('/assets/html-template-bootstrap.js');
    const css = await fetch(new URL('style.css', url));
    expect(css.status).toBe(200);
    expect(css.headers.get('access-control-allow-origin')).toBe('*');
    expect(css.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await css.text()).toBe('body{color:red}');
    const js = await fetch(new URL('app.js', url));
    expect(await js.text()).toBe('window.ready=true');
    const image = await fetch(new URL('a.png', url));
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    expect(image.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await fetch(`${url}?projectId=other`)).status).toBe(400);
  });
  it('reports invalid links and ZIP payloads without committing partial imports', async () => {
    for (const body of [
      { url: 'file:///etc/passwd' },
      { url: 'this is not a URL' },
      { filename: 'bad.txt', html: 'data' },
    ]) {
      const response = await fetch(`${base}/api/reference-pages?projectId=p`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    await expect(
      importReferencePage(root, { filename: 'broken.zip', data: Buffer.from('invalid') }),
    ).rejects.toThrow();
    expect(listReferencePages(root)).toEqual([]);
  });
  it('persists and reloads comments on an imported reference HTML without changing the original page', async () => {
    const page = await importReferencePage(root, {
      filename: 'demo.html',
      data: Buffer.from('<main>original</main>'),
    });
    const documentPath = `.axhub/make/references/${page.id}/files/${page.entryPath}`;
    const url = `${base}/api/document-comments?projectId=p&path=${encodeURIComponent(documentPath)}`;
    const document = {
      schemaVersion: 3,
      kind: 'document-edit-comments',
      documentPath,
      comments: [
        {
          id: 'reference-note',
          pageScope: 'page',
          locator: { selectors: ['main'] },
          comment: '描述组件',
          state: 'editing',
        },
      ],
      images: [],
    };
    const write = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document }),
    });
    expect(write.status).toBe(200);
    const reload = await fetch(url);
    expect(reload.status).toBe(200);
    expect((await reload.json()).document.comments[0].comment).toBe('描述组件');
    expect(fs.readFileSync(path.join(root, documentPath), 'utf8')).toBe('<main>original</main>');
  });
});
