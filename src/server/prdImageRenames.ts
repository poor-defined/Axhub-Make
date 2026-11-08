import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { listConfiguredPrdDocuments, resolveConfiguredPrdAsset } from './configuredPrd.ts';
import type { PrdImageRenamePreview, PrdImageRenameItem } from '../common/prdImageRename.ts';
import { loadPrdNamingRules, prdDocumentPrefix, prdFeatureMarker, prdSectionKey, prdImageMarker, prdImageOrdinal, prdAttachmentMarker, type PrdNamingRules } from './prdNamingRules.ts';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
interface Link { start: number; end: number; url: string; label?: string; groupKey?: string; usageIndex?: number; altStart?: number; altEnd?: number; image: boolean; }
function scan(content: string, rules: PrdNamingRules): Link[] {
  // Keep offsets stable while excluding fenced examples from actual references.
  const masked = content.replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*(?:\n|$)/gmu, block => block.replace(/[^\n]/gu, ' '));
  const links: Link[] = [];
  const inline = /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\r\n]+>|(?:\\.|[^\s)])+)(?:\s+[^\r\n)]*)?\)/gdu;
  const contextAt = (index: number): Pick<Link, 'label' | 'groupKey'> => {
    const line = masked.slice(masked.lastIndexOf('\n', index - 1) + 1, masked.indexOf('\n', index) < 0 ? masked.length : masked.indexOf('\n', index));
    const row = line.replace(/<br\s*\/?>/giu, ' ').match(/^\|\s*(F\d+)\s*\|\s*([^|]+)\|/iu);
    const heading = [...masked.slice(0, index).matchAll(/^#{1,6}\s+(.+)$/gmu)].at(-1)?.[1]?.trim() || '';
    const headingId = heading.match(/\bF\d+\b/iu)?.[0].toUpperCase();
    const stateLabel = line.match(/^\|\s*([^|]+)\|/u)?.[1].replace(/<[^>]+>/gu, '').trim() || '';
    const section = prdSectionKey(heading, stateLabel, rules);
    const label = row ? `${row[1].toUpperCase()} ${row[2].replace(/<[^>]+>/gu, '').trim()}`
      : headingId ? `${headingId} ${heading.replace(/[（(]?F\d+[）)]?/giu, '').trim()}`
        : section.label || heading || '补充说明';
    const groupKey = section.key;
    return { label, groupKey };
  };
  for (const match of masked.matchAll(inline)) {
    const range = match.indices![3]!;
    links.push({ start: range[0], end: range[1], url: match[3], image: match[1] === '!', ...contextAt(match.index!), altStart: match.indices![2]![0], altEnd: match.indices![2]![1] });
  }
  // Reference-style definitions and HTML image sources also need to follow renamed files.
  const imageReferences = new Map<string, number>();
  for (const usage of masked.matchAll(/!\[((?:\\.|[^\]\\])*)\](?:\[([^\]]*)\])?(?!\s*\()/gu)) {
    const id = (usage[2] || usage[1]).trim().toLowerCase();
    if (!imageReferences.has(id)) imageReferences.set(id, usage.index!);
  }
  for (const match of masked.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>\r\n]+>|\S+)/gdmu)) {
    const range = match.indices![2]!;
    const usageIndex = imageReferences.get(match[1].trim().toLowerCase());
    links.push({ start: range[0], end: range[1], url: match[2], image: usageIndex !== undefined, ...(usageIndex !== undefined ? { ...contextAt(usageIndex), usageIndex } : {}) });
  }
  for (const match of masked.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gdiu)) {
    const range = match.indices![2]!;
    links.push({ start: range[0], end: range[1], url: match[2], image: true, ...contextAt(match.index!) });
  }
  return links.sort((a, b) => (a.usageIndex ?? a.start) - (b.usageIndex ?? b.start));
}
function urlPath(value: string): string | null {
  const raw = value.startsWith('<') ? value.slice(1, -1) : value;
  if (/^(?:[a-z]+:|\/|#)/iu.test(raw)) return null;
  try { return decodeURIComponent(raw.split(/[?#]/u)[0]).replace(/\\([ ()])/gu, '$1'); } catch { throw new Error('PRD 图片路径编码无效'); }
}
function build(projectRoot: string, rules = loadPrdNamingRules()) {
  const documents = listConfiguredPrdDocuments(projectRoot);
  if (!documents.length) throw new Error('请先配置有效的 PRD 文档路径');
  if (documents.length > 50) throw new Error('PRD 文档过多，请配置更具体的文件或目录');
  const sources = new Map<string, { target: string; item: PrdImageRenameItem; bytes: Buffer }>();
  const docs: Array<{ path: string; before: string; after: string; links: Link[]; resolved: Map<Link, string> }> = [];
  const warnings = new Set<string>();
  const occupied = new Map<string, Set<number>>();
  const allocated = new Set<string>();
  const baseFor = (documentPath: string, link: Link) => {
    const prefix = prdDocumentPrefix(documentPath, rules);
    const feature = link.label?.match(/^F\d+/u)?.[0];
    return feature ? prdFeatureMarker(prefix, feature, rules) : `${prefix}-${link.groupKey || 'supplement'}`;
  };
  // Reserve every referenced canonical name before allocating new images. Scope is a
  // document prefix, never an attachment directory: duplicate markers cannot match uniquely.
  for (const document of documents) {
    if (fs.statSync(document.path).size > 2 * 1024 * 1024) throw new Error('PRD 文档超过 2MB，请缩小范围');
    for (const link of scan(fs.readFileSync(document.path, 'utf8'), rules).filter(link => link.image)) {
      const relative = urlPath(link.url);
      if (!relative) continue;
      const base = baseFor(document.path, link);
      const ordinal = prdImageOrdinal(base, prdAttachmentMarker(relative), rules);
      if (ordinal !== undefined) {
        const values = occupied.get(base) || new Set<number>(); values.add(ordinal); occupied.set(base, values);
      }
    }
  }
  let referenceCount = 0;
  let imageBytes = 0;
  for (const document of documents) {
    if (fs.statSync(document.path).size > 2 * 1024 * 1024) throw new Error('PRD 文档超过 2MB，请缩小范围');
    const before = fs.readFileSync(document.path, 'utf8');
    const links = scan(before, rules);
    const resolved = new Map<Link, string>();
    for (const link of links) {
      const relative = urlPath(link.url);
      if (!relative) { if (link.image) warnings.add('外部链接、嵌入图片不会重命名。'); continue; }
      const source = resolveConfiguredPrdAsset(projectRoot, document.id, relative);
      if (!source) { if (link.image) throw new Error(`图片不存在或不在配置目录内：${relative}`); continue; }
      resolved.set(link, source);
      if (!link.image) continue;
      const lexical = path.resolve(path.dirname(document.path), relative);
      if (fs.lstatSync(lexical).isSymbolicLink()) throw new Error(`图片附件不允许符号链接：${relative}`);
      if (!sources.has(source)) {
        const size = fs.statSync(source).size;
        if (size > 20 * 1024 * 1024 || imageBytes + size > 100 * 1024 * 1024) throw new Error('图片附件超过扫描大小限制（单文件 20MB，总计 100MB）');
        imageBytes += size;
        const base = baseFor(document.path, link);
        const values = occupied.get(base) || new Set<number>();
        let ordinal = prdImageOrdinal(base, prdAttachmentMarker(source), rules);
        if (ordinal === undefined) {
          ordinal = rules.sequence.first;
          while (values.has(ordinal)) ordinal++;
          values.add(ordinal); occupied.set(base, values);
        }
        const marker = prdImageMarker(base, ordinal, rules);
        if (allocated.has(marker)) throw new Error(`PRD 命名表标记重复：${marker}，请区分文档前缀或图片身份`);
        allocated.add(marker);
        const target = path.join(path.dirname(source), `${marker}${path.extname(source).toLowerCase()}`);
        sources.set(source, { target, bytes: fs.readFileSync(source), item: { documentPath: document.path, from: path.relative(path.dirname(document.path), source).split(path.sep).join('/'), to: path.relative(path.dirname(document.path), target).split(path.sep).join('/'), label: link.label || `页面总览${ordinal > 1 ? ` ${ordinal}` : ''}`, references: 0 } });
      }
    }
    docs.push({ path: document.path, before, after: before, links, resolved });
  }
  const targets = new Set<string>();
  for (const [source, entry] of sources) {
    const lower = entry.target.toLocaleLowerCase();
    if (targets.has(lower)) throw new Error(`建议文件名重复：${entry.target}`);
    targets.add(lower);
    if (source !== entry.target && fs.existsSync(entry.target) && !sources.has(entry.target)) throw new Error(`目标附件已存在，不会覆盖：${entry.target}`);
  }
  for (const doc of docs) {
    const { links, resolved } = doc;
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    for (const link of links) {
      const source = resolved.get(link), entry = source ? sources.get(source) : undefined;
      if (!entry) continue;
      entry.item.references++;
      const raw = link.url.startsWith('<') ? link.url.slice(1, -1) : link.url;
      const suffix = raw.match(/[?#].*$/u)?.[0] || '';
      const relative = path.relative(path.dirname(doc.path), entry.target).split(path.sep).join('/').replace(/[%\s#?()[\]<>]/gu, char => encodeURIComponent(char));
      const value = link.url.startsWith('<') ? `<${relative}${suffix}>` : relative + suffix;
      if (value !== link.url) replacements.push({ start: link.start, end: link.end, value });
      if (link.image && link.altStart !== undefined && link.altEnd !== undefined) {
        const label = link.label || entry.item.label;
        if (doc.before.slice(link.altStart, link.altEnd) !== label) replacements.push({ start: link.altStart, end: link.altEnd, value: label.replace(/[\[\]\\]/gu, '\\$&') });
      }
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) doc.after = doc.after.slice(0, replacement.start) + replacement.value + doc.after.slice(replacement.end);
    referenceCount += replacements.length;
  }
  const changedDocs = docs.filter(doc => doc.before !== doc.after);
  const changed = [...sources.entries()].filter(([source, entry]) => source !== entry.target || changedDocs.some(doc => doc.path === entry.item.documentPath));
  if ([...sources.values()].some(entry => entry.item.references > 1)) warnings.add('同一附件多处引用时只改名一次，相关引用会统一更新。');
  const digest = hash(JSON.stringify({ rules, documents: docs.map(doc => [doc.path, hash(doc.before)]), images: [...sources].map(([source, entry]) => [source, entry.target, hash(entry.bytes)]) }));
  const preview: PrdImageRenamePreview = { digest, items: changed.map(([, entry]) => entry.item), documentCount: documents.length, referenceCount, warnings: [...warnings], backupParentDirectory: path.join(fs.realpathSync(projectRoot), '.axhub/make/prd-image-renames') };
  const catalog: PrdNamingCatalog = {
    rules,
    documents: documents.map(document => {
      const prefix = prdDocumentPrefix(document.path, rules);
      return {
        id: document.id, prefix,
        features: Object.entries(rules.features).map(([id, feature]) => ({ id, label: feature.label, marker: prdFeatureMarker(prefix, id, rules) })),
        images: (() => {
          const doc = docs.find(doc => doc.path === document.path)!;
          const seen = new Set<string>();
          return doc.links.filter(link => link.image).flatMap(link => {
            const source = doc.resolved.get(link), entry = source ? sources.get(source) : undefined;
            if (!entry || seen.has(source!)) return [];
            seen.add(source!);
            return [{
              from: path.relative(path.dirname(document.path), source!).split(path.sep).join('/'),
              to: path.relative(path.dirname(document.path), entry.target).split(path.sep).join('/'),
              label: link.label || entry.item.label, marker: prdAttachmentMarker(entry.target),
            }];
          });
        })(),
      };
    }),
  };
  return { preview, catalog, docs: changedDocs, images: changed.filter(([source, entry]) => source !== entry.target) };
}
export interface PrdNamingCatalog {
  rules: PrdNamingRules;
  documents: Array<{ id: string; prefix: string; features: Array<{ id: string; label: string; marker: string }>;
    images: Array<{ from: string; to: string; label: string; marker: string }> }>;
}
/** The AI receives the complete table, even when no attachments currently need renaming. */
export function buildPrdNamingCatalog(projectRoot: string): PrdNamingCatalog { return build(projectRoot).catalog; }
export function previewPrdImageRenames(projectRoot: string): PrdImageRenamePreview { return build(projectRoot).preview; }
export function applyPrdImageRenames(projectRoot: string, digest: string): { backupDirectory: string; renamed: number } {
  const plan = build(projectRoot);
  if (!digest || digest !== plan.preview.digest) throw new Error('文档或图片已发生变化，请重新扫描并确认');
  if (!plan.preview.items.length) throw new Error('没有需要修改的图片引用');
  const root = fs.realpathSync(projectRoot);
  let cursor = root;
  for (const segment of ['.axhub', 'make', 'prd-image-renames']) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && (fs.lstatSync(cursor).isSymbolicLink() || !fs.statSync(cursor).isDirectory())) throw new Error('备份目录无效');
    fs.mkdirSync(cursor, { recursive: true });
  }
  const backupDirectory = path.join(cursor, randomUUID()); fs.mkdirSync(backupDirectory);
  const manifest: Array<{ original: string; backup: string }> = [];
  for (const file of [...plan.docs.map(doc => doc.path), ...plan.images.map(([source]) => source)]) {
    const backup = path.join(backupDirectory, String(manifest.length));
    fs.copyFileSync(file, backup); manifest.push({ original: file, backup });
  }
  fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const staged: Array<{ source: string; target: string; temporary: string }> = [];
  try {
    for (const [source, entry] of plan.images) {
      const temporary = path.join(path.dirname(source), `.prd-rename-${randomUUID()}`);
      fs.renameSync(source, temporary); staged.push({ source, target: entry.target, temporary });
    }
    for (const entry of staged) fs.renameSync(entry.temporary, entry.target);
    for (const doc of plan.docs) {
      const temporary = `${doc.path}.rename-${randomUUID()}`;
      try { fs.writeFileSync(temporary, doc.after); fs.renameSync(temporary, doc.path); }
      finally { fs.rmSync(temporary, { force: true }); }
    }
  } catch (error) {
    for (const entry of staged) {
      fs.rmSync(entry.temporary, { force: true });
      if (!manifest.some(file => file.original === entry.target)) fs.rmSync(entry.target, { force: true });
    }
    for (const file of manifest) fs.copyFileSync(file.backup, file.original);
    throw error;
  }
  return { backupDirectory, renamed: plan.preview.items.length };
}

/** Exact local image references for screenshot replacement; no file or reference renaming. */
export function listPrdScreenshotAssets(projectRoot: string, documentId: string): Array<{ asset: string; path: string; hash: string }> {
  const document = listConfiguredPrdDocuments(projectRoot).find(doc => doc.id === documentId);
  if (!document) throw new Error('请在项目设置中配置此 PRD 的路径');
  const seen = new Set<string>();
  return scan(fs.readFileSync(document.path, 'utf8'), loadPrdNamingRules()).filter(link => link.image).flatMap(link => {
    const relative = urlPath(link.url);
    if (!relative) return [];
    const file = resolveConfiguredPrdAsset(projectRoot, documentId, relative);
    if (!file) throw new Error(`图片附件不存在或不在配置目录内：${relative}`);
    if (seen.has(file)) return [];
    seen.add(file);
    return [{ asset: relative, path: file, hash: hash(fs.readFileSync(file)) }];
  });
}
