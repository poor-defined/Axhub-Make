import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, serialize } from 'parse5';
import { unzipSync } from 'fflate';
export interface ReferencePage {
  id: string;
  title: string;
  entryPath: string;
  htmlFiles: string[];
  createdAt: string;
  sourceUrl?: string;
  sourceDirectory?: string;
  sourceFingerprint?: string;
  sourceModifiedAt?: string;
  updatedAt?: string;
  warnings: string[];
}
export interface ReferenceImportInput {
  url?: string;
  filename?: string;
  data?: Buffer;
  title?: string;
  entryPath?: string;
  fetcher?: typeof fetch;
}
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 1500;
function safePath(value: string): string {
  const normalized = value.replace(/\\/gu, '/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  )
    throw new Error('参考页面包含不安全路径');
  return normalized.replace(/^\.\//u, '');
}
function cacheRoot(projectRoot: string): string {
  const project = fs.realpathSync(projectRoot);
  const target = path.join(project, '.axhub', 'make', 'references');
  let current = project;
  for (const segment of ['.axhub', 'make', 'references']) {
    current = path.join(current, segment);
    if (
      fs.existsSync(current) &&
      (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory())
    ) {
      throw new Error('参考缓存目录不允许符号链接');
    }
  }
  return target;
}
export function listReferencePages(projectRoot: string): ReferencePage[] {
  const root = cacheRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9-]+$/u.test(entry.name))
    .flatMap((entry) => {
      try {
        const manifest = path.join(root, entry.name, 'manifest.json');
        if (fs.lstatSync(manifest).isSymbolicLink()) return [];
        const page = JSON.parse(fs.readFileSync(manifest, 'utf8')) as ReferencePage;
        return page.id === entry.name && typeof page.entryPath === 'string' ? [page] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function resolveReferenceFile(projectRoot: string, id: string, relative: string): string {
  if (!/^[a-zA-Z0-9-]+$/u.test(id)) throw new Error('无效参考页面 ID');
  const normalized = safePath(relative);
  const pageRoot = path.join(cacheRoot(projectRoot), id);
  const root = path.join(pageRoot, 'files');
  if (fs.lstatSync(pageRoot).isSymbolicLink() || fs.lstatSync(root).isSymbolicLink())
    throw new Error('参考资源不允许符号链接');
  const target = path.join(root, normalized);
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`) || !fs.statSync(realTarget).isFile())
    throw new Error('参考资源路径无效');
  // Even an internal symlink can expose mutable files that were never imported.
  let cursor = root;
  for (const segment of normalized.split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('参考资源不允许符号链接');
  }
  return realTarget;
}
function walk(node: any, visit: (node: any) => void): void {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}
function htmlTitle(html: string): string {
  let title = '';
  walk(parse(html), (node) => {
    if (node.tagName === 'title')
      title = (node.childNodes || []).map((child: any) => child.value || '').join('');
  });
  return title.trim();
}
function resourceAttributes(node: any): any[] {
  return (node.attrs || []).filter(
    (attr: any) =>
      attr.name === 'src' ||
      attr.name === 'poster' ||
      (attr.name === 'href' &&
        node.tagName === 'link' &&
        /stylesheet|icon|preload/iu.test(
          node.attrs.find((item: any) => item.name === 'rel')?.value || '',
        )),
  );
}
function cssReferences(css: string): string[] {
  return [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/giu)].map(
    (match) => match[1] || match[2],
  );
}
function ignoredUrl(value: string): boolean {
  return /^(?:data:|blob:|javascript:|mailto:|tel:|#)/iu.test(value) || !value.trim();
}
function fileForUrl(url: URL, main: URL): string {
  let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (
    url.origin === main.origin &&
    url.pathname === main.pathname &&
    !/\.html?$/iu.test(pathname)
  ) {
    pathname = pathname.endsWith('/') ? `${pathname}index.html` : `${pathname}.html`;
  }
  return safePath(
    url.origin === main.origin
      ? pathname
      : `_external/${createHash('sha256').update(url.origin).digest('hex').slice(0, 12)}/${pathname}`,
  );
}
async function downloadCurrentPage(input: ReferenceImportInput): Promise<{
  files: Map<string, Buffer>;
  entryPath: string;
  warnings: string[];
}> {
  let main = new URL(input.url!);
  const playerPage = new URLSearchParams(main.hash.slice(1)).get('p');
  if (playerPage && /(?:^|\/)(?:start|index)\.html?$/iu.test(main.pathname)) {
    const pageName = safePath(/\.html?$/iu.test(playerPage) ? playerPage : `${playerPage}.html`);
    main = new URL(pageName, main);
  }
  if (!['http:', 'https:'].includes(main.protocol) || main.username || main.password)
    throw new Error('请使用 HTTP 或 HTTPS 页面链接');
  main.hash = '';
  const fetcher = input.fetcher || fetch;
  const files = new Map<string, Buffer>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  const entryPath = fileForUrl(main, main);
  async function load(url: URL, isMain = false): Promise<void> {
    url.hash = '';
    if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) return;
    if (seen.size >= MAX_FILES) throw new Error('参考页面资源过多，请上传 ZIP');
    seen.add(url.href);
    const local = fileForUrl(url, main);
    if (files.has(local)) return;
    let response: Response;
    try {
      response = await fetcher(url.href, {
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES)
        throw new Error('资源超过 20MB');
    } catch (error) {
      if (isMain)
        throw new Error(`参考页面下载失败：${error instanceof Error ? error.message : '网络错误'}`);
      warnings.push(`资源未缓存：${url.href}`);
      return;
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.length;
          if (bytes > MAX_FILE_BYTES || total + bytes > MAX_TOTAL_BYTES)
            throw new Error('参考页面资源超过大小限制');
          chunks.push(result.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    total += bytes;
    let data = Buffer.concat(chunks);
    files.set(local, data);
    const relative = (target: URL) =>
      path.posix.relative(path.posix.dirname(local), fileForUrl(target, main)) ||
      path.posix.basename(local);
    const pending: URL[] = [];
    const queue = (value: string, base = url): string => {
      if (ignoredUrl(value)) return value;
      try {
        const next = new URL(value, base);
        if (!['http:', 'https:'].includes(next.protocol)) return value;
        pending.push(next);
        return relative(next) + next.hash;
      } catch {
        return value;
      }
    };
    const rewriteCss = (css: string, base = url): string => {
      for (const reference of cssReferences(css)) {
        const replacement = queue(reference, base);
        if (replacement !== reference) css = css.split(reference).join(replacement);
      }
      return css;
    };
    if (isMain || /\.html?$/iu.test(url.pathname)) {
      const document = parse(data.toString('utf8'));
      let base = new URL(response.url || url.href);
      walk(document, (node) => {
        if (node.tagName === 'base') {
          const href = node.attrs.find((attr: any) => attr.name === 'href');
          if (href) {
            try {
              base = new URL(href.value, base);
            } catch {}
            href.value = './';
          }
        }
      });
      walk(document, (node) => {
        for (const attr of resourceAttributes(node)) attr.value = queue(attr.value, base);
        for (const attr of node.attrs || []) {
          if (attr.name === 'srcset')
            attr.value = attr.value
              .split(',')
              .map((part: string) => {
                const pieces = part.trim().split(/\s+/u);
                pieces[0] = queue(pieces[0], base);
                return pieces.join(' ');
              })
              .join(', ');
          if (attr.name === 'style') attr.value = rewriteCss(attr.value, base);
          if (attr.name === 'href' && node.tagName === 'a' && !ignoredUrl(attr.value)) {
            try {
              attr.value = new URL(attr.value, base).href;
              node.attrs.push(
                { name: 'target', value: '_blank' },
                { name: 'rel', value: 'noopener noreferrer' },
              );
            } catch {}
          }
        }
        if (node.tagName === 'style')
          for (const child of node.childNodes || [])
            if (child.value) child.value = rewriteCss(child.value, base);
      });
      data = Buffer.from(serialize(document));
    } else if (/\.css$/iu.test(url.pathname)) {
      let css = data.toString('utf8');
      for (const reference of cssReferences(css)) {
        const replacement = queue(reference);
        if (replacement !== reference) css = css.split(reference).join(replacement);
      }
      data = Buffer.from(css);
    } else if (/\.js$/iu.test(url.pathname)) {
      // Axure registers page CSS/images and runtime modules in string literals.
      const script = data.toString('utf8');
      for (const match of script.matchAll(
        /['"]([^'"\n\r]+\.(?:css|js|png|jpe?g|svg|gif|webp|woff2?)(?:\?[^'"\s]*)?)['"]/giu,
      )) {
        if (ignoredUrl(match[1]) || /[{}<>]/u.test(match[1])) continue;
        try {
          const target = new URL(match[1], main);
          if (target.origin === main.origin) pending.push(target);
        } catch {}
      }
    }
    files.set(local, data);
    for (const next of pending) await load(next);
  }
  await load(main, true);
  return { files, entryPath, warnings };
}
export async function importReferencePage(
  projectRoot: string,
  input: ReferenceImportInput,
): Promise<ReferencePage> {
  let files = new Map<string, Buffer>();
  let warnings: string[] = [];
  let entryPath = '';
  if (input.url) ({ files, entryPath, warnings } = await downloadCurrentPage(input));
  else {
    if (!input.data || !input.filename) throw new Error('请选择 HTML / ZIP 文件或输入页面链接');
    if (input.data.length > MAX_TOTAL_BYTES) throw new Error('上传文件超过 100MB');
    if (/\.zip$/iu.test(input.filename)) {
      let total = 0;
      let count = 0;
      const entries = unzipSync(input.data, {
        filter(entry) {
          safePath(entry.name);
          if (
            ++count > MAX_FILES ||
            entry.originalSize > MAX_FILE_BYTES ||
            (total += entry.originalSize) > MAX_TOTAL_BYTES
          )
            throw new Error('ZIP 解压资源超过大小限制');
          return !entry.name.endsWith('/');
        },
      });
      for (const [name, data] of Object.entries(entries))
        if (!name.startsWith('__MACOSX/')) files.set(safePath(name), Buffer.from(data));
      const html = [...files.keys()].filter((name) => /\.html?$/iu.test(name)).sort();
      entryPath = input.entryPath
        ? safePath(input.entryPath)
        : html.find((name) => /(^|\/)index\.html?$/iu.test(name)) ||
          html.find((name) => !/(^|\/)(?:start|chm_start)\.html?$/iu.test(name)) ||
          html[0] ||
          '';
      if (!entryPath || !files.has(entryPath) || !/\.html?$/iu.test(entryPath))
        throw new Error('ZIP 中未找到指定 HTML 页面');
    } else if (/\.html?$/iu.test(input.filename)) {
      entryPath = safePath(path.basename(input.filename));
      files.set(entryPath, input.data);
    } else throw new Error('仅支持 ZIP 或 HTML 文件');
    const checkReference = (source: string, value: string): void => {
      if (ignoredUrl(value)) return;
      if (/^(?:https?:)?\/\//iu.test(value)) {
        warnings.push(`页面依赖外部资源：${value}`);
        return;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(value.split(/[?#]/u)[0]);
      } catch {
        warnings.push(`资源路径编码无效：${value}`);
        return;
      }
      const target = path.posix.normalize(
        decoded.startsWith('/')
          ? decoded.slice(1)
          : path.posix.join(path.posix.dirname(source), decoded),
      );
      if (!files.has(target)) warnings.push(`缺少资源：${value}（${source}）`);
    };
    for (const [source, content] of files) {
      if (/\.css$/iu.test(source)) {
        for (const reference of cssReferences(content.toString('utf8')))
          checkReference(source, reference);
      } else if (/\.html?$/iu.test(source)) {
        walk(parse(content.toString('utf8')), (node) => {
          for (const attr of resourceAttributes(node)) checkReference(source, attr.value);
          for (const attr of node.attrs || [])
            if (attr.name === 'style') {
              for (const reference of cssReferences(attr.value)) checkReference(source, reference);
            }
          if (node.tagName === 'style')
            for (const child of node.childNodes || []) {
              for (const reference of cssReferences(child.value || ''))
                checkReference(source, reference);
            }
        });
      }
    }
  }
  return persistReferencePage(projectRoot, files, {
    id: randomUUID(),
    title: input.title?.trim() || htmlTitle(files.get(entryPath)!.toString('utf8')) || path.basename(entryPath),
    entryPath,
    htmlFiles: [...files.keys()].filter((name) => /\.html?$/iu.test(name)),
    createdAt: new Date().toISOString(),
    warnings: [...new Set(warnings)],
    ...(input.url ? { sourceUrl: input.url } : {}),
  });
}

function persistReferencePage(projectRoot: string, files: Map<string, Buffer>, page: ReferencePage): ReferencePage {
  const root = cacheRoot(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const destination = path.join(root, page.id);
  const staging = path.join(root, `.import-${randomUUID()}`);
  const backup = path.join(root, `.backup-${randomUUID()}`);
  try {
    fs.mkdirSync(path.join(staging, 'files'), { recursive: true });
    for (const [name, data] of files) {
      const target = path.join(staging, 'files', safePath(name));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(page, null, 2));
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try { fs.renameSync(staging, destination); }
    catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return page;
}

export interface LocalReferenceStatus {
  directory?: string;
  suppressed?: boolean;
  error?: string;
}

function localImportState(projectRoot: string): { suppressedDirectories: string[] } {
  const file = path.join(cacheRoot(projectRoot), '.local-import-state.json');
  if (!fs.existsSync(file)) return { suppressedDirectories: [] };
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('参考同步配置不允许符号链接');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { suppressedDirectories: Array.isArray(state.suppressedDirectories) ? state.suppressedDirectories.filter((item: unknown) => typeof item === 'string') : [] };
}

function writeLocalImportState(projectRoot: string, state: { suppressedDirectories: string[] }): void {
  const root = cacheRoot(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const temporary = path.join(root, `.local-state-${randomUUID()}`);
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, path.join(root, '.local-import-state.json'));
}

export function deleteReferencePage(projectRoot: string, id: string): void {
  if (!/^[a-zA-Z0-9-]+$/u.test(id)) throw new Error('无效参考页面 ID');
  const directory = path.join(cacheRoot(projectRoot), id);
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('参考缓存目录不允许符号链接');
  const page = listReferencePages(projectRoot).find(item => item.id === id);
  if (!page) throw new Error('参考页面不存在');
  if (page.sourceDirectory) {
    const configFile = path.join(projectRoot, '.axhub/make/axhub.config.json');
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const configured = config.projectInfo?.axurePublishDirectory;
      if (typeof configured === 'string' && configured.trim()) {
        let configuredDirectory = path.resolve(configured.trim());
        try { configuredDirectory = fs.realpathSync(configuredDirectory); } catch { /* The publisher may have moved the directory. */ }
        if (configuredDirectory === page.sourceDirectory) {
          config.projectInfo.axurePublishDirectory = null;
          const temporary = `${configFile}.tmp-${randomUUID()}`;
          try {
            fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
            fs.renameSync(temporary, configFile);
          } finally { fs.rmSync(temporary, { force: true }); }
        }
      }
    }
  }
  fs.rmSync(directory, { recursive: true });
}

/** Snapshot only; never modify the publisher's files. Failed scans retain the last good cache. */
export function syncLocalReferencePages(projectRoot: string, options: { restore?: boolean; force?: boolean } = {}): LocalReferenceStatus {
  let directory: string | undefined;
  try {
    const configFile = path.join(projectRoot, '.axhub/make/axhub.config.json');
    if (!fs.existsSync(configFile)) return {};
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const configured = config.projectInfo?.axurePublishDirectory;
    if (typeof configured !== 'string' || !configured.trim()) return {};
    directory = configured.trim();
    if (!path.isAbsolute(directory)) throw new Error('本地发布目录须为绝对路径');
    directory = fs.realpathSync(directory);
    if (!fs.statSync(directory).isDirectory()) throw new Error('本地发布路径不是目录');
    const state = localImportState(projectRoot);
    if (options.restore) {
      state.suppressedDirectories = state.suppressedDirectories.filter(item => item !== directory);
      writeLocalImportState(projectRoot, state);
    } else if (state.suppressedDirectories.includes(directory)) return { directory, suppressed: true };
    const files = new Map<string, Buffer>();
    const hash = createHash('sha256');
    let total = 0;
    let latestModifiedMs = 0;
    function collect(relative: string): void {
      for (const entry of fs.readdirSync(path.join(directory!, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || ['node_modules', '__MACOSX'].includes(entry.name)) continue;
        const name = safePath(path.posix.join(relative, entry.name));
        const absolute = path.join(directory!, name);
        if (entry.isSymbolicLink()) throw new Error(`本地发布目录不允许符号链接：${name}`);
        if (entry.isDirectory()) collect(name);
        else if (entry.isFile()) {
          const stat = fs.statSync(absolute);
          const size = stat.size;
          latestModifiedMs = Math.max(latestModifiedMs, stat.mtimeMs);
          if (files.size >= MAX_FILES || size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) throw new Error('本地发布资源超过限制（1500 个文件 / 单文件 20MB / 总计 100MB）');
          const content = fs.readFileSync(absolute);
          total += content.length;
          if (total > MAX_TOTAL_BYTES || content.length > MAX_FILE_BYTES) throw new Error('本地发布资源超过大小限制');
          hash.update(name).update('\0').update(content).update('\0');
          files.set(name, content);
        }
      }
    }
    collect('');
    const html = [...files.keys()].filter(name => /\.html?$/iu.test(name) && !/^(resources|plugins|files)\//iu.test(name));
    const contentPages = html.filter(name => !/(^|\/)(index|start|start_c_1|start_with_pages|chm_start)\.html?$/iu.test(name));
    // Axure leaves old exports on disk. Prefer the current document's URL literals,
    // including obfuscated variable declarations, without executing exported scripts.
    const documentScript = files.get('data/document.js')?.toString('utf8') || '';
    const publishedPages = [...documentScript.matchAll(/(['"])([^'"\r\n\\]+\.html?)\1/giu)]
      .flatMap(match => {
        try {
          const name = decodeURIComponent(match[2]);
          return contentPages.includes(name) ? [name] : [];
        } catch { return []; }
      });
    const htmlFiles = publishedPages.length ? [...new Set(publishedPages)]
      : contentPages.length ? contentPages : html.filter(name => /(^|\/)index\.html?$/iu.test(name));
    if (!htmlFiles.length) throw new Error('本地发布目录中未找到可预览的 HTML 页面');
    const fingerprint = hash.digest('hex');
    const sourceModifiedAt = new Date(latestModifiedMs).toISOString();
    const previous = listReferencePages(projectRoot).find(page => page.sourceDirectory === directory);
    if (!options.force && previous?.sourceFingerprint === fingerprint
      && previous.sourceModifiedAt === sourceModifiedAt
      && previous.htmlFiles.join('\0') === htmlFiles.join('\0')
      && htmlFiles.includes(previous.entryPath)) return { directory, suppressed: false };
    const entryPath = previous && htmlFiles.includes(previous.entryPath) ? previous.entryPath : htmlFiles[0];
    persistReferencePage(projectRoot, files, {
      id: previous?.id || randomUUID(),
      title: path.basename(directory),
      entryPath, htmlFiles,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceDirectory: directory,
      sourceFingerprint: fingerprint,
      sourceModifiedAt,
      warnings: [],
    });
    return { directory, suppressed: false };
  } catch (error) {
    return { directory, error: `本地发布导入失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
