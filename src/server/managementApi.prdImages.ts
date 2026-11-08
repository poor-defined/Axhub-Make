import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './http.ts';
import { previewPrdImageRenames, applyPrdImageRenames } from './prdImageRenames.ts';
import type { ManagementApiOptions } from './managementApi.ts';
interface Handlers {
  resolveProjectContext: (req: IncomingMessage, res: ServerResponse, options: ManagementApiOptions, mode: 'explicit-required') => { project: { root: string } } | null;
}
export function handlePrdImagesApi(req: IncomingMessage, res: ServerResponse, options: ManagementApiOptions, pathname: string, handlers: Handlers): boolean {
  if (!['/api/prd-images/preview', '/api/prd-images/apply'].includes(pathname)) return false;
  const context = handlers.resolveProjectContext(req, res, options, 'explicit-required');
  if (!context) return true;
  void (async () => {
    if (pathname.endsWith('/preview') && req.method === 'GET') {
      sendJson(res, previewPrdImageRenames(context.project.root)); return;
    }
    if (pathname.endsWith('/apply') && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (typeof body.digest !== 'string') throw new Error('请先扫描并确认改名清单');
      sendJson(res, applyPrdImageRenames(context.project.root, body.digest)); return;
    }
    sendJson(res, { error: 'Method not allowed' }, { status: 405 });
  })().catch(error => sendJson(res, { error: error instanceof Error ? error.message : 'PRD 图片整理失败' }, { status: 400 }));
  return true;
}
