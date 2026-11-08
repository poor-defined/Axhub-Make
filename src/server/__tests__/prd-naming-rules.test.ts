import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PRD_NAMING_RULES_URL, loadPrdNamingRules, prdDocumentPrefix } from '../prdNamingRules.ts';
import { previewPrdImageRenames, applyPrdImageRenames } from '../prdImageRenames.ts';
import { buildAxureOrganizationSkillContext, validateAxurePrdNamingCatalog } from '../axureOrganizationSkills.ts';
import { previewPrdScreenshots, createPrdScreenshotJob, applyPrdScreenshotJob } from '../prdScreenshots.ts';
import { validateAxurePrdMarkers } from '../../common/axurePrdMarkers.ts';
import type { AxureTreeSummary, AxureTreePlan } from '../../common/axureTreeOrganization.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-naming-')); roots.push(root);
  fs.mkdirSync(path.join(root, '.axhub/make'), { recursive: true });
  fs.mkdirSync(path.join(root, 'publish'));
  fs.writeFileSync(path.join(root, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { prdDocumentPath: path.join(root, 'CFD PRD.md'), axurePublishDirectory: path.join(root, 'publish') } }));
  fs.writeFileSync(path.join(root, 'CFD PRD.md'), '# PRD\n## 用户端需求\n| F02 | 首屏 | ![](old.png) |');
  fs.writeFileSync(path.join(root, 'old.png'), 'original image');
  return root;
}
const summary: AxureTreeSummary = { version: 1, nodes: [{ id: 'hero', name: 'div', parentId: null, order: 0, itemType: 1, canGroupChildren: false, text: '', rect: { location: { x: 0, y: 0 }, size: { width: 100, height: 50 } } }] };
const planFor = (marker: string): AxureTreePlan => ({ version: 1, groups: [], renames: [{ id: 'hero', name: `grp_F02_首屏 [prd:${marker}]` }] });
function changeRules(mutator: (rules: ReturnType<typeof loadPrdNamingRules>) => void) {
  const rules = loadPrdNamingRules(); mutator(rules);
  const original = fs.readFileSync.bind(fs);
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...args: any[]) => {
    const target = file instanceof URL ? fileURLToPath(file) : String(file);
    return target === fileURLToPath(PRD_NAMING_RULES_URL) ? JSON.stringify(rules) : (original as any)(file, ...args);
  }) as typeof fs.readFileSync);
}
it('uses one edited JSON table for the AI catalog, attachment rename and screenshot lookup', () => {
  const root = fixture();
  changeRules(rules => { rules.features.F02.suffix = 'main-visual'; });
  const rename = previewPrdImageRenames(root);
  expect(rename.items[0].to).toBe('cfd-f02-main-visual.png');
  const context = buildAxureOrganizationSkillContext(root, ['$organize-axure-by-prd']);
  expect(context.namingCatalog?.documents[0].images[0].marker).toBe('cfd-f02-main-visual');
  const plan = planFor('cfd-f02-main-visual');
  expect(() => validateAxurePrdNamingCatalog(summary, plan, context.namingCatalog)).not.toThrow();
  expect(() => validateAxurePrdNamingCatalog(summary, planFor('cfd-f02-hero'), context.namingCatalog)).toThrow(/命名表/);
  applyPrdImageRenames(root, rename.digest);
  fs.writeFileSync(path.join(root, 'publish/home.html'), `<div data-label="${plan.renames[0].name}"></div>`);
  const screenshot = previewPrdScreenshots(root, 'configured-prd/CFD PRD.md');
  expect(screenshot.items).toEqual([{ asset: 'cfd-f02-main-visual.png', marker: 'cfd-f02-main-visual', pages: ['home.html'] }]);
  expect(previewPrdImageRenames(root).items).toEqual([]);
});
it('rejects an AI result produced before the shared naming table changed', () => {
  const root = fixture();
  const context = buildAxureOrganizationSkillContext(root, ['$organize-axure-by-prd']);
  changeRules(rules => { rules.features.F02.suffix = 'main-visual'; });
  expect(() => validateAxurePrdNamingCatalog(summary, planFor('cfd-f02-hero'), context.namingCatalog)).toThrow(/命名表.*变化/);
});
it('invalidates rename and screenshot confirmations after a rule edit without modifying originals', async () => {
  const root = fixture();
  const rename = previewPrdImageRenames(root);
  applyPrdImageRenames(root, rename.digest);
  fs.writeFileSync(path.join(root, 'publish/home.html'), '<div data-label="首屏 [prd:cfd-f02-hero]"></div>');
  const document = 'configured-prd/CFD PRD.md';
  const shot = previewPrdScreenshots(root, document);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==', 'base64');
  const job = await createPrdScreenshotJob(root, 'p', document, shot.digest, [{ asset: 'cfd-f02-hero.png', page: 'home.html' }], async () => [{ key: 'cfd-f02-hero.png', png }]);
  const currentRename = previewPrdImageRenames(root);
  changeRules(rules => { rules.features.F02.label = '首屏区域'; });
  expect(() => applyPrdImageRenames(root, currentRename.digest)).toThrow(/变化/);
  expect(() => applyPrdScreenshotJob(root, job.jobId)).toThrow(/变化/);
  expect(fs.readFileSync(path.join(root, 'cfd-f02-hero.png'), 'utf8')).toBe('original image');
});
it('preserves existing unique markers and distinguishes copies from PRD screenshot ordinals', () => {
  const root = fixture();
  const context = buildAxureOrganizationSkillContext(root, ['$organize-axure-by-prd']);
  const source: AxureTreeSummary = { version: 1, nodes: [
    { ...summary.nodes[0], name: 'grp_F02_首屏 [prd:legacy-hero]' },
    { ...summary.nodes[0], id: 'copy', order: 1, name: 'grp_F02_副本 [prd:legacy-hero]' },
  ] };
  const plan: AxureTreePlan = { version: 1, groups: [], renames: [{ id: 'copy', name: 'grp_F02_副本 [prd:legacy-hero-copy-01]' }] };
  expect(() => { validateAxurePrdMarkers(source, plan); validateAxurePrdNamingCatalog(source, plan, context.namingCatalog); }).not.toThrow();
  expect(() => validateAxurePrdNamingCatalog(source, { ...plan, renames: [{ id: 'copy', name: 'grp_F02_副本 [prd:legacy-hero-02]' }] }, context.namingCatalog)).toThrow(/命名表/);
});
it('does not let a copied component claim another real screenshot identity in the catalog', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'second.png'), 'second image');
  fs.appendFileSync(path.join(root, 'CFD PRD.md'), '\n| F02 | 首屏 | ![](second.png) |');
  const context = buildAxureOrganizationSkillContext(root, ['$organize-axure-by-prd']);
  const source: AxureTreeSummary = { version: 1, nodes: [
    { ...summary.nodes[0], name: 'grp_F02_首屏 [prd:cfd-f02-hero]' },
    { ...summary.nodes[0], id: 'copy', order: 1, name: 'grp_F02_副本 [prd:cfd-f02-hero]' },
  ] };
  const plan: AxureTreePlan = { version: 1, groups: [], renames: [{ id: 'copy', name: 'grp_F02_副本 [prd:cfd-f02-hero-02]' }] };
  expect(() => validateAxurePrdNamingCatalog(source, plan, context.namingCatalog)).toThrow(/副本.*命名表/);
});
it('uses the same deterministic prefix for a PRD without an ASCII filename prefix and rejects invalid JSON rules', () => {
  const rules = loadPrdNamingRules();
  expect(prdDocumentPrefix('/one/落地页 PRD.md', rules)).toMatch(/^prd-[a-f0-9]{6}$/);
  expect(prdDocumentPrefix('/one/落地页 PRD.md', rules)).toBe(prdDocumentPrefix('/two/落地页 PRD.md', rules));
  changeRules(rules => { rules.features.F02.suffix = 'Invalid_marker'; });
  expect(() => loadPrdNamingRules()).toThrow(/命名表/);
});
it('refuses a feature absent from the shared naming table instead of inventing a suffix', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'CFD PRD.md'), '| F12 | 新功能 | ![](old.png) |');
  expect(() => previewPrdImageRenames(root)).toThrow(/命名表.*F12/);
  expect(() => buildAxureOrganizationSkillContext(root, ['$organize-axure-by-prd'])).toThrow(/命名表.*F12/);
});
