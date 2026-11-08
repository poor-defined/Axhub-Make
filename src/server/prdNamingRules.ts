import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface PrdNamingRules {
  version: 1;
  prefix: { source: 'document-basename-first-ascii-token'; fallback: string; hashLength: number };
  features: Record<string, { label: string; suffix: string }>;
  sections: {
    overview: { headingPattern: string; suffix: string };
    login: { headingPattern: string; suffix: string; states: Array<{ labelPattern: string; suffix: string }> };
    fallback: { suffix: string; hashLength: number };
  };
  sequence: { first: 1; width: number; omitFirst: true };
  copy: { suffix: string; first: 1; width: number };
  component: { suffix: string };
  identity: { markerFormat: '[prd:{marker}]'; attachmentFormat: '{marker}{extension}'; preserveExistingUniqueMarker: true };
}
export const PRD_NAMING_RULES_URL = new URL('../../client/.workbuddy/skills/organize-axure-by-prd/references/naming-rules.json', import.meta.url);
export const isPrdMarker = (value: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
const hash = (value: string, length: number) => createHash('sha256').update(value).digest('hex').slice(0, length);
/** Read on each operation so the skill, rename and capture cannot use different cached versions. */
export function loadPrdNamingRules(): PrdNamingRules {
  try {
    const rules = JSON.parse(fs.readFileSync(PRD_NAMING_RULES_URL, 'utf8')) as PrdNamingRules;
    const suffixes = [rules.prefix.fallback, rules.sections.overview.suffix, rules.sections.login.suffix,
      rules.sections.fallback.suffix, rules.copy.suffix, rules.component.suffix,
      ...rules.sections.login.states.map(state => state.suffix), ...Object.values(rules.features).map(feature => feature.suffix)];
    const widths = [rules.sequence.width, rules.copy.width];
    if (rules.version !== 1 || rules.prefix.source !== 'document-basename-first-ascii-token'
      || rules.identity.markerFormat !== '[prd:{marker}]' || rules.identity.attachmentFormat !== '{marker}{extension}' || rules.identity.preserveExistingUniqueMarker !== true
      || rules.sequence.first !== 1 || rules.copy.first !== 1 || rules.sequence.omitFirst !== true
      || !Object.keys(rules.features).length || Object.keys(rules.features).some(key => !/^F\d+$/u.test(key))
      || Object.values(rules.features).some(feature => typeof feature.label !== 'string')
      || suffixes.some(value => typeof value !== 'string' || !isPrdMarker(value))
      || widths.some(value => !Number.isInteger(value) || value < 2 || value > 6)
      || [rules.prefix.hashLength, rules.sections.fallback.hashLength].some(value => !Number.isInteger(value) || value < 6 || value > 32)) throw new Error('不支持的规则格式');
    for (const pattern of [rules.sections.overview.headingPattern, rules.sections.login.headingPattern, ...rules.sections.login.states.map(state => state.labelPattern)]) {
      if (typeof pattern !== 'string' || !pattern || pattern.length > 200) throw new Error('章节匹配条件无效');
      new RegExp(pattern, 'iu');
    }
    return rules;
  } catch { throw new Error('PRD 命名表 naming-rules.json 无效，请修正规则后重试'); }
}
export function prdDocumentPrefix(documentPath: string, rules: PrdNamingRules): string {
  const basename = path.basename(documentPath);
  return (basename.match(/^[a-z][a-z0-9]*/iu)?.[0] || `${rules.prefix.fallback}-${hash(basename, rules.prefix.hashLength)}`).toLowerCase();
}
export function prdFeatureMarker(prefix: string, feature: string, rules: PrdNamingRules): string {
  const suffix = rules.features[feature.toUpperCase()]?.suffix;
  if (!suffix) throw new Error(`共享 PRD 命名表未配置 ${feature.toUpperCase()}，请先补充 naming-rules.json`);
  return `${prefix}-${feature.toLowerCase()}-${suffix}`;
}
export function prdSectionKey(heading: string, stateLabel: string, rules: PrdNamingRules): { key: string; label?: string } {
  if (new RegExp(rules.sections.login.headingPattern, 'iu').test(heading)) {
    const state = rules.sections.login.states.find(state => new RegExp(state.labelPattern, 'iu').test(stateLabel));
    return { key: `${rules.sections.login.suffix}${state ? `-${state.suffix}` : ''}`, label: `登录 ${stateLabel || heading}` };
  }
  if (new RegExp(rules.sections.overview.headingPattern, 'iu').test(heading)) return { key: rules.sections.overview.suffix, label: '页面总览' };
  return { key: `${rules.sections.fallback.suffix}-${hash(heading || 'supplement', rules.sections.fallback.hashLength)}` };
}
export function prdImageMarker(base: string, ordinal: number, rules: PrdNamingRules): string {
  return `${base}${ordinal === rules.sequence.first ? '' : `-${String(ordinal).padStart(rules.sequence.width, '0')}`}`;
}
/** Recognize an existing identity without reassigning it when Markdown image order changes. */
export function prdImageOrdinal(base: string, marker: string, rules: PrdNamingRules): number | undefined {
  if (marker === base) return rules.sequence.first;
  if (!marker.startsWith(`${base}-`)) return undefined;
  const value = Number(marker.slice(base.length + 1));
  return Number.isSafeInteger(value) && value > rules.sequence.first && prdImageMarker(base, value, rules) === marker ? value : undefined;
}
export function prdAttachmentMarker(asset: string): string {
  return path.basename(asset, path.extname(asset));
}
