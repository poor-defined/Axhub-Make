import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { previewPrdScreenshots, createPrdScreenshotJob, applyPrdScreenshotJob } from '../prdScreenshots.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it('matches attachment basenames to source name markers and reports multiple pages without guessing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-shots-')); roots.push(root);
  const publish = path.join(root, 'publish'), docs = path.join(root, 'docs');
  fs.mkdirSync(path.join(root, '.axhub/make'), { recursive: true }); fs.mkdirSync(publish); fs.mkdirSync(docs);
  fs.writeFileSync(path.join(root, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: docs, axurePublishDirectory: publish } }));
  fs.writeFileSync(path.join(docs, 'PRD.md'), '![首屏](cfd-f02-hero.png)\n![FAQ](cfd-f08-faq.png)');
  fs.writeFileSync(path.join(docs, 'cfd-f02-hero.png'), 'old'); fs.writeFileSync(path.join(docs, 'cfd-f08-faq.png'), 'old');
  fs.writeFileSync(path.join(publish, 'one.html'), '<div data-label="首屏 [prd:cfd-f02-hero]"></div>');
  fs.writeFileSync(path.join(publish, 'two.html'), '<div data-label="首屏 [prd:cfd-f02-hero]"></div>');
  const result = previewPrdScreenshots(root, 'configured-prd/PRD.md');
  expect(result.items[0]).toMatchObject({ marker: 'cfd-f02-hero', pages: ['one.html', 'two.html'] });
  expect(result.items[1].error).toMatch(/未找到/);
  expect(fs.readFileSync(path.join(docs, 'cfd-f02-hero.png'), 'utf8')).toBe('old');
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-shot-job-')); roots.push(root);
  fs.mkdirSync(path.join(root, '.axhub/make'), { recursive: true });
  fs.mkdirSync(path.join(root, 'publish')); fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: path.join(root, 'docs'), axurePublishDirectory: path.join(root, 'publish') } }));
  fs.writeFileSync(path.join(root, 'publish/home.html'), '<div data-label="Hero [prd:hero]"></div>');
  fs.writeFileSync(path.join(root, 'docs/PRD.md'), '![Hero](hero.png)'); fs.writeFileSync(path.join(root, 'docs/hero.png'), 'old image');
  return root;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==', 'base64');
it('stages screenshots for preview and replaces only after confirmation, keeping Markdown and backups', async () => {
  const root = fixture(), document = 'configured-prd/PRD.md';
  const plan = previewPrdScreenshots(root, document);
  const job = await createPrdScreenshotJob(root, 'p', document, plan.digest, [{ asset: 'hero.png', page: 'home.html' }], async (_source, requests) => requests.map(r => ({ key: r.key, png })));
  expect(job.items[0].previewUrl).toContain('/api/prd-screenshots/image');
  expect(fs.readFileSync(path.join(root, 'docs/hero.png'), 'utf8')).toBe('old image');
  const result = applyPrdScreenshotJob(root, job.jobId);
  expect(result.updated).toBe(1);
  expect(fs.readFileSync(path.join(root, 'docs/hero.png'))).toEqual(png);
  expect(fs.readFileSync(path.join(root, 'docs/PRD.md'), 'utf8')).toBe('![Hero](hero.png)');
  expect(fs.readFileSync(path.join(result.backupDirectory, '0.png'), 'utf8')).toBe('old image');
  expect(() => applyPrdScreenshotJob(root, job.jobId)).toThrow(/已替换/);
});
it('rejects stale screenshot previews and retains originals when capture fails', async () => {
  const root = fixture(), document = 'configured-prd/PRD.md';
  const plan = previewPrdScreenshots(root, document);
  const failed = await createPrdScreenshotJob(root, 'p', document, plan.digest, [{ asset: 'hero.png', page: 'home.html' }], async () => [{ key: 'hero.png', error: '区域不可见' }]);
  expect(() => applyPrdScreenshotJob(root, failed.jobId)).toThrow(/没有/);
  const job = await createPrdScreenshotJob(root, 'p', document, plan.digest, [{ asset: 'hero.png', page: 'home.html' }], async () => [{ key: 'hero.png', png }]);
  fs.appendFileSync(path.join(root, 'docs/PRD.md'), '\n编辑后的要求');
  expect(() => applyPrdScreenshotJob(root, job.jobId)).toThrow(/变化/);
  expect(fs.readFileSync(path.join(root, 'docs/hero.png'), 'utf8')).toBe('old image');
});
