import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestUrl, readJsonBody, sendFile, sendJson } from './http.ts';
import { previewPrdScreenshots, createPrdScreenshotJob, getPrdScreenshotImage, applyPrdScreenshotJob, discardPrdScreenshotJob } from './prdScreenshots.ts';
import type { ManagementApiOptions } from './managementApi.ts';
interface Handlers { resolveProjectContext: (req: IncomingMessage, res: ServerResponse, options: ManagementApiOptions, mode: 'explicit-required') => { project: { id: string; root: string } } | null; }
const running = new Set<string>();
export function handlePrdScreenshotsApi(req: IncomingMessage, res: ServerResponse, options: ManagementApiOptions, pathname: string, handlers: Handlers): boolean {
  if (!['preview', 'capture', 'image', 'apply', 'discard'].some(action => pathname === `/api/prd-screenshots/${action}`)) return false;
  const context = handlers.resolveProjectContext(req, res, options, 'explicit-required');
  if (!context) return true;
  const { root, id } = context.project;
  void (async () => {
    const query = getRequestUrl(req).searchParams;
    if (pathname.endsWith('/preview') && req.method === 'GET') { sendJson(res, previewPrdScreenshots(root, query.get('document') || '')); return; }
    if (pathname.endsWith('/image') && req.method === 'GET') {
      const file = getPrdScreenshotImage(root, query.get('jobId') || '', query.get('file') || '');
      if (!sendFile(res, file, { cacheControl: 'no-store' })) throw new Error('截图预览不存在'); return;
    }
    if (req.method === 'POST' && pathname.endsWith('/capture')) {
      if (running.has(root)) throw new Error('当前项目正在生成截图，请等待完成后重试');
      running.add(root);
      try { const body = await readJsonBody(req); sendJson(res, await createPrdScreenshotJob(root, id, String(body.document || ''), String(body.digest || ''), body.selections)); }
      finally { running.delete(root); }
      return;
    }
    if (req.method === 'POST' && pathname.endsWith('/apply')) {
      const body = await readJsonBody(req); sendJson(res, applyPrdScreenshotJob(root, String(body.jobId || ''))); return;
    }
    if (req.method === 'POST' && pathname.endsWith('/discard')) {
      const body = await readJsonBody(req); discardPrdScreenshotJob(root, String(body.jobId || '')); sendJson(res, { success: true }); return;
    }
    sendJson(res, { error: 'Method not allowed' }, { status: 405 });
  })().catch(error => { if (!res.writableEnded && !res.destroyed) sendJson(res, { error: error instanceof Error ? error.message : '截图更新失败' }, { status: 400 }); });
  return true;
}
