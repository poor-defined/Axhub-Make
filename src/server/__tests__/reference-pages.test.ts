import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  importReferencePage,
  listReferencePages,
  resolveReferenceFile,
  deleteReferencePage,
  syncLocalReferencePages,
} from '../referencePages.ts';
const roots: string[] = [];
const root = () => {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-test-'));
  roots.push(value);
  return value;
};
afterEach(() =>
  roots.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true })),
);
describe('reference page cache', () => {
  it('reports the latest publication file modification time, including unchanged files republished later', () => {
    const project = root(), publish = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    fs.writeFileSync(path.join(publish, 'index.html'), 'original');
    fs.writeFileSync(path.join(publish, 'style.css'), 'body{}');
    const earlier = new Date('2026-11-08T01:00:00Z'), later = new Date('2026-11-08T02:00:00Z');
    fs.utimesSync(path.join(publish, 'index.html'), earlier, earlier);
    fs.utimesSync(path.join(publish, 'style.css'), later, later);
    syncLocalReferencePages(project);
    const page = listReferencePages(project)[0];
    expect(page.sourceModifiedAt).toBe(later.toISOString());
    const republished = new Date('2026-11-08T03:00:00Z');
    fs.utimesSync(path.join(publish, 'index.html'), republished, republished);
    syncLocalReferencePages(project);
    expect(listReferencePages(project)[0]).toMatchObject({ id: page.id, sourceFingerprint: page.sourceFingerprint, sourceModifiedAt: republished.toISOString() });
  });
  it('automatically imports local published content pages and updates the same cache on republish', () => {
    const project = root(), publish = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    fs.mkdirSync(path.join(publish, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(publish, 'index.html'), '<iframe></iframe>');
    fs.writeFileSync(path.join(publish, 'start.html'), 'shell');
    fs.writeFileSync(path.join(publish, 'start_with_pages.html'), 'shell');
    fs.writeFileSync(path.join(publish, 'old_page.html'), 'left over from an older export');
    fs.mkdirSync(path.join(publish, 'data'), { recursive: true });
    fs.writeFileSync(path.join(publish, 'data/document.js'), 'var pageUrl="首页.html";');
    fs.writeFileSync(path.join(publish, 'resources/helper.html'), 'helper');
    fs.writeFileSync(path.join(publish, '首页.html'), '<title>首页</title>version 1');
    expect(syncLocalReferencePages(project).error).toBeUndefined();
    const page = listReferencePages(project)[0];
    expect(page.entryPath).toBe('首页.html');
    expect(page.htmlFiles).toEqual(['首页.html']);
    expect(page.sourceDirectory).toBe(fs.realpathSync(publish));
    syncLocalReferencePages(project);
    expect(listReferencePages(project)).toEqual([page]);
    // An older importer may have cached player shells and stale exported pages.
    fs.writeFileSync(path.join(project, '.axhub/make/references', page.id, 'manifest.json'), JSON.stringify({ ...page, htmlFiles: ['index.html', 'old_page.html'] }));
    syncLocalReferencePages(project);
    expect(listReferencePages(project)[0].htmlFiles).toEqual(['首页.html']);
    fs.writeFileSync(path.join(publish, '首页.html'), 'version 2');
    syncLocalReferencePages(project);
    expect(listReferencePages(project)).toHaveLength(1);
    expect(listReferencePages(project)[0].id).toBe(page.id);
    expect(listReferencePages(project)[0].sourceFingerprint).not.toBe(page.sourceFingerprint);
    expect(fs.readFileSync(resolveReferenceFile(project, page.id, page.entryPath), 'utf8')).toContain('version 2');
  });
  it('deletes local references and clears only the configured publication path while keeping original files', () => {
    const project = root(), publish = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    fs.writeFileSync(path.join(publish, 'index.html'), 'original');
    syncLocalReferencePages(project);
    const page = listReferencePages(project)[0];
    deleteReferencePage(project, page.id);
    expect(listReferencePages(project)).toEqual([]);
    const configFile = path.join(project, '.axhub/make/axhub.config.json');
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8')).projectInfo.axurePublishDirectory).toBeNull();
    expect(syncLocalReferencePages(project).directory).toBeUndefined();
    expect(fs.readFileSync(path.join(publish, 'index.html'), 'utf8')).toBe('original');
    fs.writeFileSync(configFile, JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    syncLocalReferencePages(project);
    expect(listReferencePages(project)).toHaveLength(1);
    expect(() => deleteReferencePage(project, '../escape')).toThrow();
  });
  it('forces a fresh snapshot even when the publication fingerprint is unchanged', () => {
    const project = root(), publish = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    fs.writeFileSync(path.join(publish, 'index.html'), 'original');
    syncLocalReferencePages(project);
    const page = listReferencePages(project)[0];
    const cacheFile = resolveReferenceFile(project, page.id, page.entryPath);
    fs.writeFileSync(cacheFile, 'cached edit');
    syncLocalReferencePages(project, { force: true });
    expect(fs.readFileSync(cacheFile, 'utf8')).toBe('original');
    expect(listReferencePages(project)[0].id).toBe(page.id);
  });
  it('keeps other project settings and never clears a newer publication path when deleting an older reference', () => {
    const project = root(), publish = root(), newer = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    const configFile = path.join(project, '.axhub/make/axhub.config.json');
    const config = { server: { host: 'localhost' }, projectInfo: { axurePublishDirectory: publish, prdDocumentPath: '/docs/PRD.md' } };
    fs.writeFileSync(configFile, JSON.stringify(config));
    fs.writeFileSync(path.join(publish, 'index.html'), 'original');
    syncLocalReferencePages(project);
    deleteReferencePage(project, listReferencePages(project)[0].id);
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8'))).toEqual({ ...config, projectInfo: { ...config.projectInfo, axurePublishDirectory: null } });
    fs.writeFileSync(configFile, JSON.stringify(config));
    syncLocalReferencePages(project);
    const old = listReferencePages(project)[0];
    config.projectInfo.axurePublishDirectory = newer;
    fs.writeFileSync(configFile, JSON.stringify(config));
    deleteReferencePage(project, old.id);
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8'))).toEqual(config);
  });
  it('retains the last good cache and reports inaccessible or unsafe publication folders', () => {
    const project = root(), publish = root();
    fs.mkdirSync(path.join(project, '.axhub/make'), { recursive: true });
    fs.writeFileSync(path.join(project, '.axhub/make/axhub.config.json'), JSON.stringify({ projectInfo: { axurePublishDirectory: publish } }));
    fs.writeFileSync(path.join(publish, 'index.html'), 'good');
    syncLocalReferencePages(project);
    const previous = listReferencePages(project);
    fs.symlinkSync('/etc/passwd', path.join(publish, 'secret'));
    expect(syncLocalReferencePages(project).error).toMatch(/符号链接/);
    expect(listReferencePages(project)).toEqual(previous);
    fs.rmSync(publish, { recursive: true });
    expect(syncLocalReferencePages(project).error).toBeTruthy();
    expect(listReferencePages(project)).toEqual(previous);
  });
  it('imports standalone HTML, reports missing assets and persists project listing', async () => {
    const projectRoot = root();
    const page = await importReferencePage(projectRoot, {
      filename: 'page.html',
      data: Buffer.from('<title>支付</title><img src="missing.png"><h1>订单</h1>'),
    });
    expect(page.title).toBe('支付');
    expect(page.warnings.join()).toContain('missing.png');
    expect(listReferencePages(projectRoot)).toEqual([page]);
    expect(
      fs.readFileSync(resolveReferenceFile(projectRoot, page.id, page.entryPath), 'utf8'),
    ).toContain('订单');
  });
  it('keeps ZIP directory relationships and selects actual page before Axure shell', async () => {
    const projectRoot = root();
    const data = zipSync({
      'publish/start.html': strToU8('<iframe></iframe>'),
      'publish/order.html': strToU8(
        '<link href="files/order/styles.css"><img src="images/pay.png">',
      ),
      'publish/files/order/styles.css': strToU8('body{}'),
      'publish/images/pay.png': new Uint8Array([1]),
    });
    const page = await importReferencePage(projectRoot, {
      filename: 'axure.zip',
      data: Buffer.from(data),
      entryPath: 'publish/order.html',
    });
    expect(page.entryPath).toBe('publish/order.html');
    expect(page.warnings).toEqual([]);
    expect(
      fs.existsSync(resolveReferenceFile(projectRoot, page.id, 'publish/files/order/styles.css')),
    ).toBe(true);
  });
  it('rejects traversal ZIP and never leaves partial reference entries', async () => {
    const projectRoot = root();
    await expect(
      importReferencePage(projectRoot, {
        filename: 'bad.zip',
        data: Buffer.from(zipSync({ '../escape.html': strToU8('bad') })),
      }),
    ).rejects.toThrow(/路径/);
    expect(listReferencePages(projectRoot)).toEqual([]);
  });
  it('refuses files outside cache including symlink targets', async () => {
    const projectRoot = root();
    const page = await importReferencePage(projectRoot, {
      filename: 'page.html',
      data: Buffer.from('hello'),
    });
    expect(() => resolveReferenceFile(projectRoot, page.id, '../../manifest.json')).toThrow();
    fs.symlinkSync(
      '/etc/passwd',
      path.join(path.dirname(resolveReferenceFile(projectRoot, page.id, page.entryPath)), 'secret'),
    );
    expect(() => resolveReferenceFile(projectRoot, page.id, 'secret')).toThrow();
  });
  it('caches only current URL page and its CSS, image, script dependencies', async () => {
    const projectRoot = root();
    const requests: string[] = [];
    const pages: Record<string, string> = {
      'https://example.test/page.html':
        '<title>Remote</title><link rel="stylesheet" href="css/main.css"><script src="resources/axure.js"></script><a href="other.html">other</a><img src="images/a.png">',
      'https://example.test/css/main.css':
        '@import "nested.css";body{background:url(../images/b.png)}',
      'https://example.test/css/nested.css': 'h1{}',
      'https://example.test/resources/axure.js': 'console.log(1)',
      'https://example.test/images/a.png': 'a',
      'https://example.test/images/b.png': 'b',
    };
    const fetcher = async (input: string | URL) => {
      const key = String(input);
      requests.push(key);
      return new Response(pages[key], {
        status: key in pages ? 200 : 404,
        headers: { 'content-type': key.endsWith('.css') ? 'text/css' : 'text/html' },
      });
    };
    const page = await importReferencePage(projectRoot, {
      url: 'https://example.test/page.html',
      fetcher: fetcher as typeof fetch,
    });
    expect(requests).not.toContain('https://example.test/other.html');
    expect(requests).toContain('https://example.test/css/nested.css');
    expect(requests).toContain('https://example.test/images/b.png');
    const html = fs.readFileSync(
      resolveReferenceFile(projectRoot, page.id, page.entryPath),
      'utf8',
    );
    expect(html).toContain('https://example.test/other.html');
    expect(page.warnings).toEqual([]);
  });
  it('rejects symlink reference directories even when the requested file resolves', async () => {
    const projectRoot = root();
    const outside = root();
    fs.mkdirSync(path.join(outside, 'files'));
    fs.writeFileSync(path.join(outside, 'files', 'secret.html'), 'secret');
    fs.mkdirSync(path.join(projectRoot, '.axhub', 'make', 'references'), { recursive: true });
    fs.symlinkSync(outside, path.join(projectRoot, '.axhub', 'make', 'references', 'fake'));
    expect(() => resolveReferenceFile(projectRoot, 'fake', 'secret.html')).toThrow();
  });
  it('refuses ZIP data that would expand beyond the resource size limit', async () => {
    const projectRoot = root();
    const data = Buffer.from(zipSync({ 'index.html': new Uint8Array(21 * 1024 * 1024) }));
    await expect(importReferencePage(projectRoot, { filename: 'large.zip', data })).rejects.toThrow(
      /大小限制/,
    );
  });
  it('imports the selected page behind an Axure start.html#p player URL', async () => {
    const projectRoot = root();
    const requests: string[] = [];
    const page = await importReferencePage(projectRoot, {
      url: 'https://example.test/project/start.html#p=order',
      fetcher: (async (value: string | URL) => {
        requests.push(String(value));
        return new Response('<title>Order</title><button>Pay</button>');
      }) as typeof fetch,
    });
    expect(requests[0]).toBe('https://example.test/project/order.html');
    expect(page.entryPath).toBe('project/order.html');
    expect(page.sourceUrl).toContain('start.html#p=order');
  });
  it('handles URL encoded Axure page names and extensionless HTML endpoints', async () => {
    const projectRoot = root();
    const requests: string[] = [];
    const fetcher = (async (value: string | URL) => {
      requests.push(String(value));
      return new Response('<title>订单</title><p>组件</p>');
    }) as typeof fetch;
    const page = await importReferencePage(projectRoot, {
      url: 'https://example.test/start.html#p=%E8%AE%A2%E5%8D%95',
      fetcher,
    });
    expect(requests[0]).toBe('https://example.test/%E8%AE%A2%E5%8D%95.html');
    expect(page.entryPath).toBe('订单.html');
    const dynamic = await importReferencePage(projectRoot, {
      url: 'https://example.test/prototype',
      fetcher,
    });
    expect(dynamic.entryPath).toBe('prototype.html');
    expect(dynamic.htmlFiles).toEqual(['prototype.html']);
  });
  it('caches style-block imports and nested iframe dependencies without following navigation links', async () => {
    const projectRoot = root();
    const requests: string[] = [];
    const bodies: Record<string, string> = {
      'https://example.test/main.html': `<style>@import 'theme.css';</style><iframe src="panel.html"></iframe><a href="next.html">Next</a>`,
      'https://example.test/theme.css': 'body{}',
      'https://example.test/panel.html':
        '<link rel="stylesheet" href="panel.css"><img src="panel.png">',
      'https://example.test/panel.css': 'main{}',
      'https://example.test/panel.png': 'image',
    };
    const fetcher = (async (value: string | URL) => {
      requests.push(String(value));
      return new Response(bodies[String(value)], { status: String(value) in bodies ? 200 : 404 });
    }) as typeof fetch;
    const page = await importReferencePage(projectRoot, {
      url: 'https://example.test/main.html',
      fetcher,
    });
    expect(requests).toContain('https://example.test/theme.css');
    expect(requests).toContain('https://example.test/panel.css');
    expect(requests).toContain('https://example.test/panel.png');
    expect(requests).not.toContain('https://example.test/next.html');
    expect(page.warnings).toEqual([]);
  });
  it('reports missing background images and fonts referenced inside uploaded CSS', async () => {
    const projectRoot = root();
    const data = zipSync({
      'index.html': strToU8('<link rel="stylesheet" href="theme.css">'),
      'theme.css': strToU8(
        'body{background:url(images/missing.png)}@font-face{src:url(fonts/missing.woff2)}',
      ),
    });
    const page = await importReferencePage(projectRoot, {
      filename: 'bundle.zip',
      data: Buffer.from(data),
    });
    expect(page.warnings.join()).toContain('images/missing.png');
    expect(page.warnings.join()).toContain('fonts/missing.woff2');
  });
});
