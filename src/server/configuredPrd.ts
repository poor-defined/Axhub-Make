import fs from 'node:fs';
import path from 'node:path';
export const CONFIGURED_PRD_PREFIX = 'configured-prd/';
function configuration(projectRoot: string): { root: string; file?: string } | null {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, '.axhub/make/axhub.config.json'), 'utf8'));
    const value = config.projectInfo?.prdDocumentPath;
    if (typeof value !== 'string' || !path.isAbsolute(value.trim())) return null;
    const target = fs.realpathSync(value.trim());
    if (fs.statSync(target).isDirectory()) return { root: target };
    return /\.md$/iu.test(target) && fs.statSync(target).isFile() ? { root: path.dirname(target), file: target } : null;
  } catch { return null; }
}
function contained(root: string, target: string): boolean {
  return target.startsWith(root + path.sep);
}
export function listConfiguredPrdDocuments(projectRoot: string) {
  const config = configuration(projectRoot);
  if (!config) return [];
  const paths: string[] = [];
  function scan(directory: string): void {
    if (paths.length >= 500) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.name === 'node_modules') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && /\.md$/iu.test(entry.name)) paths.push(file);
      if (paths.length >= 500) break;
    }
  }
  try {
    if (config.file) paths.push(config.file); else scan(config.root);
    return paths.map(file => {
      const relative = path.relative(config.root, file).split(path.sep).join('/');
      const id = CONFIGURED_PRD_PREFIX + relative;
      const stat = fs.statSync(file);
      const title = stat.size < 20 * 1024 * 1024 ? fs.readFileSync(file, 'utf8').match(/^#\s+(.+)$/mu)?.[1]?.trim() : '';
      return { id, name: id, title: title || path.basename(file, '.md'), path: file, filePath: id, absoluteFilePath: file, description: '默认 PRD · 项目设置', updatedAt: stat.mtime.toISOString(), configuredPrd: true, ext: '.md' };
    });
  } catch { return []; }
}
export function resolveConfiguredPrdDocument(projectRoot: string, requested: string): { path: string; projectRelativePath: string } | null {
  if (!requested.startsWith(CONFIGURED_PRD_PREFIX) || requested.split('/').some(part => !part || part === '.' || part === '..') || requested.includes('\\') || requested.includes('\0')) return null;
  const config = configuration(projectRoot);
  if (!config) return null;
  const candidate = path.resolve(config.root, requested.slice(CONFIGURED_PRD_PREFIX.length));
  try {
    const real = fs.realpathSync(candidate);
    if (!contained(config.root, real) || (config.file && real !== config.file) || !/\.md$/iu.test(real) || !fs.statSync(real).isFile()) return null;
    return { path: real, projectRelativePath: requested };
  } catch { return null; }
}
export function resolveConfiguredPrdAsset(projectRoot: string, document: string, asset: string): string | null {
  const config = configuration(projectRoot), doc = resolveConfiguredPrdDocument(projectRoot, document);
  if (!config || !doc || !asset || asset.includes('\0') || asset.includes('\\') || path.isAbsolute(asset) || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/iu.test(asset)) return null;
  try {
    const real = fs.realpathSync(path.resolve(path.dirname(doc.path), asset));
    return contained(config.root, real) && fs.statSync(real).isFile() ? real : null;
  } catch { return null; }
}
