import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'parse5';
import { listConfiguredPrdDocuments, resolveConfiguredPrdAsset } from './configuredPrd.ts';
import { listPrdScreenshotAssets } from './prdImageRenames.ts';
import { listReferencePages, resolveReferenceFile, syncLocalReferencePages } from './referencePages.ts';
import { captureLocalPrototype, type LocalCaptureRequest, type LocalCaptureResult } from './localPrototypeScreenshots.ts';
import type { PrdScreenshotPlan, PrdScreenshotJob } from '../common/prdScreenshots.ts';
import { loadPrdNamingRules, prdAttachmentMarker, isPrdMarker } from './prdNamingRules.ts';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const viewport = { width: 1920, height: 1080 };
function snapshot(projectRoot: string, documentId: string) {
  const namingRules = loadPrdNamingRules();
  const document = listConfiguredPrdDocuments(projectRoot).find(item => item.id === documentId || item.path === path.resolve(projectRoot, documentId));
  if (!document) throw new Error('请先在项目设置中配置此 PRD 文档路径');
  const local = syncLocalReferencePages(projectRoot, { force: true, restore: true });
  if (local.error) throw new Error(local.error);
  if (!local.directory) throw new Error('请先在项目设置中配置 Axure 本地发布目录');
  const publication = listReferencePages(projectRoot).find(item => item.sourceDirectory === local.directory);
  if (!publication) throw new Error('本地参考发布尚未导入');
  const assets = listPrdScreenshotAssets(projectRoot, document.id);
  const markers = new Map<string, Array<{ page: string; count: number }>>();
  for (const entry of publication.htmlFiles) {
    const counts = new Map<string, number>();
    function visit(node: any) {
      const attributes = node.attrs || [];
      const label = attributes.find((a: any) => a.name === 'data-label')?.value || '';
      const direct = attributes.find((a: any) => a.name === 'data-prd-id')?.value;
      const values = new Set<string>([...String(label).matchAll(/\[prd:([a-z0-9]+(?:-[a-z0-9]+)*)\]/gu)].map(match => match[1]));
      if (direct) values.add(direct);
      for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
      for (const child of node.childNodes || []) visit(child);
    }
    visit(parse(fs.readFileSync(resolveReferenceFile(projectRoot, publication.id, entry), 'utf8')));
    for (const [marker, count] of counts) markers.set(marker, [...(markers.get(marker) || []), { page: entry, count }]);
  }
  const items = assets.map(asset => {
    const marker = prdAttachmentMarker(asset.asset);
    const matches = markers.get(marker) || [];
    const pages = matches.filter(match => match.count === 1).map(match => match.page);
    const error = path.extname(asset.asset).toLowerCase() !== '.png' ? '目前仅支持 PNG 截图附件'
      : !isPrdMarker(marker) ? '请先使用“整理图片名称”规范此附件名称'
        : !pages.length ? matches.length ? '页面内标记重复，无法唯一定位' : '本地发布中未找到对应 [prd:标识]' : undefined;
    return { asset: asset.asset, marker, pages, ...(error ? { error } : {}) };
  });
  const digest = sha(JSON.stringify({ namingRules, documentId: document.id, markdown: sha(fs.readFileSync(document.path)), source: publication.sourceFingerprint, assets, items, viewport }));
  return { plan: { digest, document: document.id, items, viewport } as PrdScreenshotPlan, document, publication, assets };
}
export function previewPrdScreenshots(projectRoot: string, documentId: string): PrdScreenshotPlan { return snapshot(projectRoot, documentId).plan; }
function jobsRoot(projectRoot: string): string {
  let cursor = fs.realpathSync(projectRoot);
  for (const segment of ['.axhub', 'make', 'prd-screenshot-jobs']) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && (fs.lstatSync(cursor).isSymbolicLink() || !fs.statSync(cursor).isDirectory())) throw new Error('截图缓存目录无效');
    fs.mkdirSync(cursor, { recursive: true });
  }
  return cursor;
}
function jobRoot(projectRoot: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error('截图任务 ID 无效');
  const target = path.join(jobsRoot(projectRoot), id);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('截图任务目录无效');
  return target;
}
interface JobManifest {
  document: string;
  digest: string;
  createdAt: number;
  applied?: boolean;
  items: Array<{ asset: string; marker: string; page: string; file?: string; hash?: string; error?: string }>;
}
function readJob(projectRoot: string, id: string): { root: string; manifest: JobManifest } {
  const root = jobRoot(projectRoot, id), file = path.join(root, 'manifest.json');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('截图任务无效');
  const manifest: JobManifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Date.now() - manifest.createdAt > 30 * 60 * 1000) throw new Error('截图预览已过期，请重新生成');
  return { root, manifest };
}
export async function createPrdScreenshotJob(projectRoot: string, projectId: string, document: string, digest: string,
  selections: Array<{ asset: string; page: string }>, capture = captureLocalPrototype): Promise<PrdScreenshotJob> {
  const current = snapshot(projectRoot, document);
  if (!digest || digest !== current.plan.digest) throw new Error('PRD、附件或发布内容已变化，请重新扫描');
  if (!Array.isArray(selections) || !selections.length || selections.length > 50) throw new Error('请选择 1–50 个可截图附件');
  const seen = new Set<string>();
  const requests: LocalCaptureRequest[] = selections.map(selection => {
    const item = current.plan.items.find(item => item.asset === selection.asset);
    if (!item || item.error || !item.pages.includes(selection.page) || seen.has(selection.asset)) throw new Error('截图来源选择无效或重复');
    seen.add(selection.asset); return { key: selection.asset, entry: selection.page, marker: item.marker };
  });
  const jobId = randomUUID(), root = jobRoot(projectRoot, jobId); fs.mkdirSync(root);
  const source = path.join(root, 'source');
  const cacheRoot = path.join(fs.realpathSync(projectRoot), '.axhub/make/references', current.publication.id, 'files');
  try {
    fs.cpSync(cacheRoot, source, { recursive: true });
    const results: LocalCaptureResult[] = await capture(source, requests, viewport);
    const items: JobManifest['items'] = requests.map((request, index) => {
      const result = results.find(item => item.key === request.key);
      const base = { asset: request.key, page: request.entry, marker: request.marker };
      if (!result?.png) return { ...base, error: result?.error || '未生成截图' };
      const png = result.png;
      if (png.length > 20 * 1024 * 1024 || png.length < 45 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.toString('ascii', png.length - 8, png.length - 4) !== 'IEND') return { ...base, error: '截图 PNG 无效' };
      const file = `${index}.png`; fs.writeFileSync(path.join(root, file), png);
      return { ...base, file, hash: sha(png) };
    });
    const manifest: JobManifest = { document, digest, items, createdAt: Date.now() };
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { jobId, items: items.map(item => ({ asset: item.asset, page: item.page, marker: item.marker, ...(item.file ? { previewUrl: `/api/prd-screenshots/image?projectId=${encodeURIComponent(projectId)}&jobId=${jobId}&file=${item.file}` } : { error: item.error }) })) };
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
  finally { fs.rmSync(source, { recursive: true, force: true }); }
}
export function getPrdScreenshotImage(projectRoot: string, jobId: string, file: string): string {
  const job = readJob(projectRoot, jobId);
  if (!/^\d+\.png$/u.test(file) || !job.manifest.items.some(item => item.file === file)) throw new Error('截图文件不存在');
  const target = path.join(job.root, file);
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error('截图文件无效');
  return target;
}
export function discardPrdScreenshotJob(projectRoot: string, jobId: string): void {
  const { root, manifest } = readJob(projectRoot, jobId);
  if (manifest.applied) throw new Error('已替换截图的任务包含原图备份，不能作为临时预览删除');
  fs.rmSync(root, { recursive: true, force: true });
}
export function applyPrdScreenshotJob(projectRoot: string, jobId: string): { updated: number; backupDirectory: string } {
  const { root, manifest } = readJob(projectRoot, jobId);
  if (manifest.applied) throw new Error('此批截图已替换，请重新扫描');
  if (snapshot(projectRoot, manifest.document).plan.digest !== manifest.digest) throw new Error('PRD、附件或发布内容已变化，请重新截图并确认');
  const items = manifest.items.filter(item => item.file && !item.error).map(item => {
    const target = resolveConfiguredPrdAsset(projectRoot, manifest.document, item.asset);
    if (!target || path.extname(target).toLowerCase() !== '.png') throw new Error('目标附件不存在或不在配置范围内');
    const file = getPrdScreenshotImage(projectRoot, jobId, item.file!);
    if (sha(fs.readFileSync(file)) !== item.hash) throw new Error('截图缓存已变化，请重新生成');
    return { target, file };
  });
  if (!items.length) throw new Error('没有可替换的成功截图');
  const backupDirectory = path.join(root, 'backup'); fs.mkdirSync(backupDirectory, { recursive: true });
  items.forEach((item, index) => fs.copyFileSync(item.target, path.join(backupDirectory, `${index}.png`)));
  fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify(items.map((item, index) => ({ original: item.target, backup: `${index}.png` })), null, 2));
  try {
    for (const item of items) {
      const temporary = `${item.target}.screenshot-${randomUUID()}`;
      try { fs.copyFileSync(item.file, temporary); fs.renameSync(temporary, item.target); }
      finally { fs.rmSync(temporary, { force: true }); }
    }
    manifest.applied = true;
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (error) { items.forEach((item, index) => fs.copyFileSync(path.join(backupDirectory, `${index}.png`), item.target)); throw error; }
  return { updated: items.length, backupDirectory };
}
