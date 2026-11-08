import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestUrl, readJsonBody, sendFile, sendJson } from './http.ts';
import { sendHtmlDocumentPreview } from './htmlDocumentPreview.ts';
import {
  importReferencePage,
  listReferencePages,
  resolveReferenceFile,
  deleteReferencePage,
  syncLocalReferencePages,
  type ReferencePage,
} from './referencePages.ts';
import type { ManagementApiOptions } from './managementApi.ts';
interface Context {
  project: {
    id: string;
    root: string;
  };
}
interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}
interface Handlers {
  resolveProjectContext: (
    req: IncomingMessage,
    res: ServerResponse,
    options: ManagementApiOptions,
    mode: 'explicit-required',
    body?: unknown,
  ) => Context | null;
  readMultipartParts: (req: IncomingMessage) => Promise<MultipartPart[]>;
}
export function referencePageWithUrl(page: ReferencePage, projectId: string, projectRoot: string) {
  return {
    ...page,
    cacheDirectory: path.join(projectRoot, '.axhub', 'make', 'references', page.id),
    previewUrl: `/api/projects/${encodeURIComponent(projectId)}/reference-pages/${encodeURIComponent(page.id)}/files/${page.entryPath.split('/').map(encodeURIComponent).join('/')}`,
  };
}
/** Imported scripts run in an opaque origin even when the cache URL is opened directly. */
export function setReferenceFileHeaders(
  res: ServerResponse,
  origin: string,
  projectId: string,
  pageId: string,
  html: boolean,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!html) return;
  const cachePrefix = `${origin}/api/projects/${encodeURIComponent(projectId)}/reference-pages/${encodeURIComponent(pageId)}/files/`;
  res.setHeader(
    'Content-Security-Policy',
    [
      'sandbox allow-scripts',
      "default-src 'self' data: blob:",
      `script-src ${cachePrefix} ${origin}/assets/ 'unsafe-inline' 'unsafe-eval' blob:`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src ${cachePrefix} ${origin}/assets/`,
      "form-action 'none'",
      `frame-src ${cachePrefix}`,
      "base-uri 'self'",
    ].join('; ') + ';',
  );
}
export function handleReferencePagesApi(
  req: IncomingMessage,
  res: ServerResponse,
  options: ManagementApiOptions,
  pathname: string,
  handlers: Handlers,
): boolean {
  const fileRoute = pathname.match(
    /^\/api\/projects\/([^/]+)\/reference-pages\/([^/]+)\/files\/(.+)$/u,
  );
  const queryFileRoute = pathname.match(/^\/api\/reference-pages\/([^/]+)\/files\/(.+)$/u);
  const deleteRoute = pathname.match(/^\/api\/reference-pages\/([a-zA-Z0-9-]+)$/u);
  const syncRoute = pathname === '/api/reference-pages/sync-local';
  if (pathname !== '/api/reference-pages' && !fileRoute && !queryFileRoute && !deleteRoute) return false;
  if (fileRoute) {
    // The existing project resolver uses the projectId query parameter. Preserve path scope
    // for every relative script/image request without depending on browser cookies.
    const requestUrl = getRequestUrl(req);
    let pathProjectId: string;
    try {
      pathProjectId = decodeURIComponent(fileRoute[1]);
    } catch {
      sendJson(res, { error: '参考页面项目路径编码无效' }, { status: 400 });
      return true;
    }
    const queryProjectId = requestUrl.searchParams.get('projectId');
    if (queryProjectId && queryProjectId !== pathProjectId) {
      sendJson(res, { error: '参考页面项目范围不一致' }, { status: 400 });
      return true;
    }
    requestUrl.searchParams.set('projectId', pathProjectId);
    req.url = `${requestUrl.pathname}${requestUrl.search}`;
  }
  const context = handlers.resolveProjectContext(req, res, options, 'explicit-required');
  if (!context) return true;
  void (async () => {
    if (req.method === 'GET' && (fileRoute || queryFileRoute)) {
      const id = decodeURIComponent(fileRoute?.[2] || queryFileRoute![1]);
      const relative = decodeURIComponent(fileRoute?.[3] || queryFileRoute![2]);
      let file: string;
      try {
        file = resolveReferenceFile(context.project.root, id, relative);
      } catch {
        sendJson(res, { error: '参考资源不存在或路径无效' }, { status: 404 });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      setReferenceFileHeaders(
        res,
        getRequestUrl(req).origin,
        context.project.id,
        id,
        /\.html?$/iu.test(path.extname(file)),
      );
      if (sendHtmlDocumentPreview(req, res, file)) return;
      if (!sendFile(res, file, { cacheControl: 'no-store' }))
        sendJson(res, { error: '参考资源不存在' }, { status: 404 });
      return;
    }
    if (req.method === 'DELETE' && deleteRoute && !syncRoute) {
      deleteReferencePage(context.project.root, deleteRoute[1]);
      sendJson(res, { success: true });
      return;
    }
    if ((req.method === 'GET' && pathname === '/api/reference-pages') || (req.method === 'POST' && syncRoute)) {
      const localSource = syncLocalReferencePages(context.project.root, { restore: syncRoute, force: syncRoute });
      sendJson(res, {
        pages: listReferencePages(context.project.root).map((page) =>
          referencePageWithUrl(page, context.project.id, context.project.root),
        ),
        localSource,
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/reference-pages') {
      let input: Parameters<typeof importReferencePage>[1];
      if (String(req.headers['content-type'] || '').includes('multipart/form-data')) {
        const parts = await handlers.readMultipartParts(req);
        const text = (name: string) =>
          parts
            .find((part) => part.name === name && !part.filename)
            ?.data.toString('utf8')
            .trim();
        const file = parts.find((part) => part.name === 'file' && part.filename);
        input = {
          url: text('url'),
          title: text('title'),
          entryPath: text('entryPath'),
          filename: file?.filename,
          data: file?.data,
        };
      } else {
        const body = await readJsonBody(req);
        input = {
          url: typeof body.url === 'string' ? body.url : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          entryPath: typeof body.entryPath === 'string' ? body.entryPath : undefined,
          filename: typeof body.filename === 'string' ? body.filename : undefined,
          data: typeof body.html === 'string' ? Buffer.from(body.html) : undefined,
        };
      }
      const page = await importReferencePage(context.project.root, input);
      sendJson(res, { page: referencePageWithUrl(page, context.project.id, context.project.root) });
      return;
    }
    sendJson(res, { error: 'Method not allowed' }, { status: 405 });
  })().catch((error) =>
    sendJson(
      res,
      { error: error instanceof Error ? error.message : '参考页面导入失败' },
      { status: 400 },
    ),
  );
  return true;
}
