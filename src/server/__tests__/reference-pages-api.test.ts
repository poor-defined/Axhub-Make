import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleReferencePagesApi } from '../managementApi.referencePages.ts';
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
async function call(
  root: string,
  method: string,
  pathname: string,
  body: unknown = {},
  authorized = true,
) {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  req.method = method;
  req.url = pathname;
  req.headers = { host: 'localhost', 'content-type': 'application/json', accept: 'text/html' };
  let done!: (value: any) => void;
  const promise = new Promise((resolve) => {
    done = resolve;
  });
  const res: any = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: (text: string) => done({ status: res.statusCode, text }),
  };
  const handlers: any = {
    resolveProjectContext: (_req: any, response: any) => {
      if (!authorized) {
        response.statusCode = 400;
        response.end('{"error":"Project required"}');
        return null;
      }
      return { project: { id: 'p', root } };
    },
    readMultipartParts: vi.fn(),
  };
  expect(handleReferencePagesApi(req, res, {} as any, pathname.split('?')[0], handlers)).toBe(true);
  return promise as Promise<any>;
}
describe('reference pages API', () => {
  it('lists and imports HTML with project-scoped preview URL and injected annotation bootstrap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'references-api-'));
    roots.push(root);
    const created = await call(root, 'POST', '/api/reference-pages?projectId=p', {
      filename: 'demo.html',
      html: '<title>Demo</title><main>hello</main>',
    });
    expect(created.status).toBe(200);
    const page = JSON.parse(created.text).page;
    expect(page.previewUrl).toBe(`/api/projects/p/reference-pages/${page.id}/files/demo.html`);
    const listing = await call(root, 'GET', '/api/reference-pages?projectId=p');
    expect(JSON.parse(listing.text).pages).toHaveLength(1);
    const preview = await call(root, 'GET', page.previewUrl);
    expect(preview.text).toContain('/assets/html-template-bootstrap.js');
    expect(preview.text).toContain('hello');
  });
  it('requires project context and rejects non-reference routes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'references-api-'));
    roots.push(root);
    expect((await call(root, 'GET', '/api/reference-pages', {}, false)).status).toBe(400);
    expect(handleReferencePagesApi({} as any, {} as any, {} as any, '/api/other', {} as any)).toBe(
      false,
    );
  });
});
