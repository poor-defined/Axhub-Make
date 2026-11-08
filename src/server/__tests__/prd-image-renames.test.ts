import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { previewPrdImageRenames, applyPrdImageRenames } from '../prdImageRenames.ts';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-project-'));
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-prd-'));
  roots.push(project, docs);
  fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
  const document = path.join(docs, 'CFD PRD.md');
  fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: document } }));
  fs.mkdirSync(path.join(docs, '图片和附件'));
  fs.writeFileSync(path.join(docs, '图片和附件/image 4.png'), 'original image');
  const markdown = '| F02 | 首屏 | ![image\\.png](图片和附件/image%204.png) | 说明 |\n';
  fs.writeFileSync(document, markdown);
  return { project, docs, document, markdown };
}
it('previews without modifying files, then renames images and references together with a backup', () => {
  const f = fixture();
  const preview = previewPrdImageRenames(f.project);
  expect(preview.items[0]).toMatchObject({ from: '图片和附件/image 4.png', to: '图片和附件/cfd-f02-hero.png', label: 'F02 首屏' });
  expect(fs.readFileSync(f.document, 'utf8')).toBe(f.markdown);
  const result = applyPrdImageRenames(f.project, preview.digest);
  expect(fs.readFileSync(path.join(f.docs, '图片和附件/cfd-f02-hero.png'), 'utf8')).toBe('original image');
  expect(fs.existsSync(path.join(f.docs, '图片和附件/image 4.png'))).toBe(false);
  expect(fs.readFileSync(f.document, 'utf8')).toContain('![F02 首屏](图片和附件/cfd-f02-hero.png)');
  expect(fs.existsSync(result.backupDirectory)).toBe(true);
  expect(previewPrdImageRenames(f.project).items).toEqual([]);
});
it('rejects a stale confirmation and refuses collisions without changing originals', () => {
  const f = fixture();
  const preview = previewPrdImageRenames(f.project);
  fs.appendFileSync(f.document, 'concurrent edit');
  expect(() => applyPrdImageRenames(f.project, preview.digest)).toThrow(/变化/);
  fs.writeFileSync(f.document, f.markdown);
  fs.writeFileSync(path.join(f.docs, '图片和附件/cfd-f02-hero.png'), 'another image');
  expect(() => previewPrdImageRenames(f.project)).toThrow(/存在/);
  expect(fs.readFileSync(path.join(f.docs, '图片和附件/image 4.png'), 'utf8')).toBe('original image');
});
it('updates every reference to a shared image and ignores fenced examples', () => {
  const f = fixture();
  fs.appendFileSync(f.document, '\n![same](图片和附件/image%204.png)\n[查看大图](图片和附件/image%204.png)\n```md\n![example](missing.png)\n```\n');
  const plan = previewPrdImageRenames(f.project);
  expect(plan.items).toHaveLength(1);
  expect(plan.items[0].references).toBe(3);
  applyPrdImageRenames(f.project, plan.digest);
  const result = fs.readFileSync(f.document, 'utf8');
  expect(result.match(/图片和附件\/cfd-f02-hero.png/gu)).toHaveLength(3);
  expect(result).toContain('![example](missing.png)');
});
it('restores document contents and original image names when a later write fails', () => {
  const f = fixture();
  const plan = previewPrdImageRenames(f.project);
  const rename = fs.renameSync.bind(fs);
  const realDocument = fs.realpathSync(f.document);
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === realDocument) throw new Error('simulated write failure');
    return rename(from, to);
  });
  expect(() => applyPrdImageRenames(f.project, plan.digest)).toThrow(/simulated/);
  expect(fs.readFileSync(f.document, 'utf8')).toBe(f.markdown);
  expect(fs.readFileSync(path.join(f.docs, '图片和附件/image 4.png'), 'utf8')).toBe('original image');
  expect(fs.existsSync(path.join(f.docs, '图片和附件/cfd-f02-hero.png'))).toBe(false);
});
it('keeps existing screenshot identities when images are reordered or added in different attachment directories', () => {
  const f = fixture();
  applyPrdImageRenames(f.project, previewPrdImageRenames(f.project).digest);
  fs.mkdirSync(path.join(f.docs, 'other'));
  fs.writeFileSync(path.join(f.docs, 'other/new.png'), 'second image');
  fs.writeFileSync(f.document, '| F02 | 首屏 | ![](other/new.png) ![](图片和附件/cfd-f02-hero.png) |');
  const plan = previewPrdImageRenames(f.project);
  expect(plan.items.find(item => item.from === 'other/new.png')?.to).toBe('other/cfd-f02-hero-02.png');
  expect(plan.items.find(item => item.from === '图片和附件/cfd-f02-hero.png')?.to).toBe('图片和附件/cfd-f02-hero.png');
});
it('takes feature and login identities from reference-image usage and HTML image locations', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.docs, 'phone.png'), 'phone');
  fs.writeFileSync(path.join(f.docs, 'login.png'), 'login');
  fs.writeFileSync(f.document, '# PRD\n| F02 | 首屏 | ![desktop][hero] <img src="phone.png"> |\n## 登录逻辑\n| 未登录 | ![login][login] |\n\n[hero]: 图片和附件/image%204.png\n[login]: login.png\n');
  const items = previewPrdImageRenames(f.project).items;
  expect(items.find(item => item.from === 'phone.png')?.to).toBe('cfd-f02-hero-02.png');
  expect(items.find(item => item.from === '图片和附件/image 4.png')?.to).toBe('图片和附件/cfd-f02-hero.png');
  expect(items.find(item => item.from === 'login.png')?.to).toBe('cfd-login-logged-out.png');
  applyPrdImageRenames(f.project, previewPrdImageRenames(f.project).digest);
  expect(fs.readFileSync(f.document, 'utf8')).toContain('[hero]: 图片和附件/cfd-f02-hero.png');
  expect(fs.readFileSync(f.document, 'utf8')).toContain('<img src="cfd-f02-hero-02.png">');
  expect(previewPrdImageRenames(f.project).items).toEqual([]);
});
it('does not classify real login images using headings inside fenced Markdown examples', () => {
  const f = fixture();
  fs.writeFileSync(f.document, '### 登录逻辑\n```md\n## F02 首屏例子\n```\n| 未登录 | ![状态][login] |\n[login]: 图片和附件/image%204.png\n');
  expect(previewPrdImageRenames(f.project).items[0].to).toBe('图片和附件/cfd-login-logged-out.png');
});
