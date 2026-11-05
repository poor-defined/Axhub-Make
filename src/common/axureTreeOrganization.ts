/** Pure snapshot adapter shared by the browser and the organization API. */
export const AXURE_TREE_LIMITS = { nodes: 2000, groups: 100, depth: 24, summaryChars: 300_000 } as const;
export interface AxureRect {
  location: { x: number; y: number };
  size: { width: number; height: number };
}
export interface AxureTreeNode {
  id: string;
  name: string;
  itemType: number;
  rect: AxureRect;
  scene?: { items: AxureTreeNode[] };
  maskedScene?: { items: AxureTreeNode[] } | null;
  [key: string]: unknown;
}
export interface AxureTreePayload {
  scene: { items: AxureTreeNode[] };
  [key: string]: unknown;
}
export interface AxureSummaryNode {
  id: string; name: string; itemType: number; parentId: string | null;
  order: number; rect: AxureRect; text: string; canGroupChildren: boolean;
}
export interface AxureTreeSummary { version: 1; nodes: AxureSummaryNode[] }
export interface AxureTreePlan {
  version: 1;
  renames: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string; parentId: string; childIds: string[] }>;
}

function fail(message: string): never { throw new Error(`Axure 组件树：${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('数据格式无效');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail('包含未支持的字段');
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f]/u.test(value)) fail('节点 ID 无效');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/u.test(value)) fail('名称必须为 1–80 个字符');
  return value.trim();
}
function rect(value: unknown): AxureRect {
  const source = object(value);
  const location = object(source.location);
  const size = object(source.size);
  for (const number of [location.x, location.y, size.width, size.height]) {
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 10_000_000) fail('节点坐标无效');
  }
  if (Number(size.width) < 0 || Number(size.height) < 0) fail('节点尺寸无效');
  return { location: { x: location.x as number, y: location.y as number }, size: { width: size.width as number, height: size.height as number } };
}
function childItems(node: Record<string, unknown>, key: 'scene' | 'maskedScene'): unknown[] {
  if (node[key] == null) return [];
  const items = object(node[key]).items;
  if (!Array.isArray(items)) fail('子节点列表无效');
  return items;
}

/** Validate every structural node, including protected mask/SVG internals. */
function inspectPayload(value: unknown): AxureTreePayload {
  const payload = object(value);
  const roots = childItems(payload, 'scene');
  if (!roots.length) fail('没有可整理的画板');
  const ids = new Set<string>();
  function visit(raw: unknown, depth: number): void {
    if (depth > AXURE_TREE_LIMITS.depth) fail('层级过深');
    const node = object(raw);
    const nodeId = id(node.id);
    if (ids.has(nodeId)) fail('节点 ID 重复或存在循环');
    ids.add(nodeId);
    if (ids.size > AXURE_TREE_LIMITS.nodes) fail('节点超过 2000 个，请缩小导出范围');
    rect(node.rect);
    if (![0, 1, 2].includes(node.itemType as number)) fail('节点类型无效');
    for (const child of [...childItems(node, 'scene'), ...childItems(node, 'maskedScene')]) visit(child, depth + 1);
  }
  for (const root of roots) {
    if (object(root).itemType !== 2) fail('根节点必须是画板');
    visit(root, 0);
  }
  return value as AxureTreePayload;
}

function textExcerpt(node: Record<string, unknown>, depth = 0): string {
  if (depth > 4) return '';
  const text = node.text && typeof node.text === 'object' ? node.text as Record<string, unknown> : null;
  const paragraphs = Array.isArray(text?.paragraphs) ? text.paragraphs : [];
  const own = paragraphs.slice(0, 4).flatMap((p) => {
    const inlines = p && Array.isArray(p.inlines) ? p.inlines : [];
    return inlines.slice(0, 8).map((inline: { text?: unknown }) => typeof inline?.text === 'string' ? inline.text.slice(0, 160) : '');
  }).join(' ');
  if (own) return own.slice(0, 240);
  return [...childItems(node, 'scene'), ...childItems(node, 'maskedScene')]
    .slice(0, 8).map((child) => textExcerpt(object(child), depth + 1)).join(' ').trim().slice(0, 240);
}

export function buildAxureTreeSummary(value: unknown): AxureTreeSummary {
  const payload = inspectPayload(value);
  const nodes: AxureSummaryNode[] = [];
  function append(node: AxureTreeNode, parentId: string | null, order: number): void {
    nodes.push({ id: node.id, name: String(node.name || '').slice(0, 80), itemType: node.itemType,
      parentId, order, rect: rect(node.rect), text: textExcerpt(node), canGroupChildren: node.itemType === 2 });
  }
  payload.scene.items.forEach((root, order) => {
    append(root, null, order);
    // Existing containers are atomic: do not enter masks, SVGs or transformed groups.
    root.scene?.items.forEach((node, index) => append(node, root.id, index));
  });
  const summary: AxureTreeSummary = { version: 1, nodes };
  if (JSON.stringify(summary).length > AXURE_TREE_LIMITS.summaryChars) fail('摘要过大，请缩小导出范围');
  return summary;
}

export function validateAxureTreeSummary(value: unknown): AxureTreeSummary {
  const source = object(value);
  exactKeys(source, ['version', 'nodes']);
  if (source.version !== 1 || !Array.isArray(source.nodes) || !source.nodes.length || source.nodes.length > AXURE_TREE_LIMITS.nodes) fail('摘要格式或节点数量无效');
  const seen = new Map<string, AxureSummaryNode>();
  const counts = new Map<string | null, number>();
  const nodes = source.nodes.map((raw) => {
    const node = object(raw);
    exactKeys(node, ['id', 'name', 'itemType', 'parentId', 'order', 'rect', 'text', 'canGroupChildren']);
    const nodeId = id(node.id);
    if (seen.has(nodeId)) fail('摘要 ID 重复');
    const parentId = node.parentId === null ? null : id(node.parentId);
    if (parentId !== null && !seen.get(parentId)?.canGroupChildren) fail('摘要父级无效');
    if (![0, 1, 2].includes(node.itemType as number) || (parentId === null ? node.itemType !== 2 : node.itemType === 2)
      || node.canGroupChildren !== (parentId === null)) fail('摘要容器类型无效');
    if (node.order !== (counts.get(parentId) || 0)) fail('摘要绘制顺序无效');
    counts.set(parentId, Number(node.order) + 1);
    if (typeof node.name !== 'string' || node.name.length > 80 || typeof node.text !== 'string' || node.text.length > 240) fail('摘要文字超出限制');
    const next: AxureSummaryNode = { id: nodeId, name: node.name, itemType: node.itemType as number, parentId,
      order: node.order as number, rect: rect(node.rect), text: node.text, canGroupChildren: node.canGroupChildren as boolean };
    seen.set(nodeId, next);
    return next;
  });
  if (JSON.stringify(nodes).length > AXURE_TREE_LIMITS.summaryChars) fail('摘要过大');
  return { version: 1, nodes };
}

export function validateAxureTreePlan(value: unknown): AxureTreePlan {
  const source = object(value);
  exactKeys(source, ['version', 'renames', 'groups']);
  if (source.version !== 1 || !Array.isArray(source.renames) || !Array.isArray(source.groups)
    || source.renames.length > AXURE_TREE_LIMITS.nodes || source.groups.length > AXURE_TREE_LIMITS.groups) fail('整理方案格式或操作数量无效');
  const renamed = new Set<string>();
  const renames = source.renames.map((raw) => {
    const entry = object(raw);
    exactKeys(entry, ['id', 'name']);
    const nodeId = id(entry.id);
    if (renamed.has(nodeId)) fail('重复重命名');
    renamed.add(nodeId);
    return { id: nodeId, name: name(entry.name) };
  });
  const groups = source.groups.map((raw) => {
    const entry = object(raw);
    exactKeys(entry, ['id', 'name', 'parentId', 'childIds']);
    const groupId = id(entry.id);
    if (!/^ai-group-[a-zA-Z0-9_-]+$/u.test(groupId)) fail('新组 ID 必须以 ai-group- 开头');
    if (!Array.isArray(entry.childIds) || entry.childIds.length < 2 || entry.childIds.length > AXURE_TREE_LIMITS.nodes) fail('分组至少需要两个节点');
    return { id: groupId, name: name(entry.name), parentId: id(entry.parentId), childIds: entry.childIds.map(id) };
  });
  return { version: 1, renames, groups };
}

export function parseAxureTreePlan(text: string): AxureTreePlan {
  if (text.length > 400_000) fail('AI 输出过大');
  // ACP emits this benign Codex startup diagnostic as text, ahead of the model response.
  // Strip only this exact diagnostic; arbitrary prose/warnings remain invalid.
  const skillBudgetDiagnostic = 'Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';
  let source = text.trim();
  if (source.startsWith(`${skillBudgetDiagnostic}\n`)) source = source.slice(skillBudgetDiagnostic.length).trimStart();
  source = source.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, '$1');
  try { return validateAxureTreePlan(JSON.parse(source)); }
  catch (error) { fail(error instanceof Error ? error.message : 'AI 未返回有效 JSON'); }
}

export function applyAxureTreePlan(value: unknown, rawPlan: unknown): AxureTreePayload {
  buildAxureTreeSummary(value);
  const plan = validateAxureTreePlan(rawPlan);
  const result = structuredClone(value) as AxureTreePayload;
  const mutable = new Map<string, AxureTreeNode>();
  const containers = new Map<string, AxureTreeNode>();
  const allIds = new Set<string>();
  function collect(node: AxureTreeNode): void {
    allIds.add(node.id);
    for (const child of [...(node.scene?.items || []), ...(node.maskedScene?.items || [])]) collect(child);
  }
  result.scene.items.forEach((root) => {
    collect(root);
    mutable.set(root.id, root);
    containers.set(root.id, root);
    root.scene?.items.forEach((node) => mutable.set(node.id, node));
  });
  for (const rename of plan.renames) {
    const node = mutable.get(rename.id);
    if (!node) fail('重命名引用了未知或受保护的节点');
    node.name = rename.name;
  }
  for (const operation of plan.groups) {
    if (allIds.has(operation.id)) fail('新组 ID 已存在');
    const siblings = containers.get(operation.parentId)?.scene?.items;
    if (!siblings) fail('不能进入未知或受保护的容器');
    const start = siblings.findIndex((node) => node.id === operation.childIds[0]);
    if (start < 0 || operation.childIds.some((childId, i) => siblings[start + i]?.id !== childId)) fail('只能按原绘制顺序组合连续兄弟节点');
    const children = siblings.slice(start, start + operation.childIds.length);
    const x = Math.min(...children.map((node) => node.rect.location.x));
    const y = Math.min(...children.map((node) => node.rect.location.y));
    const right = Math.max(...children.map((node) => node.rect.location.x + node.rect.size.width));
    const bottom = Math.max(...children.map((node) => node.rect.location.y + node.rect.size.height));
    // Same root-relative coordinates and group fields as htmlToAxure hierarchy groups.
    const group: AxureTreeNode = {
      id: operation.id, name: operation.name, itemType: 0, visible: true, isLocked: false,
      isNameDynamic: false, rotation: 0, rect: { location: { x, y }, size: { width: right - x, height: bottom - y } },
      resizingConstraints: { hasFixedLeft: true, hasFixedRight: false, hasFixedTop: true, hasFixedBottom: false, hasFixedWidth: true, hasFixedHeight: true },
      effects: [], isMask: false, flippedHorizontal: false, flippedVertical: false, opacity: 1,
      scene: { items: children },
    };
    siblings.splice(start, children.length, group);
    containers.set(group.id, group);
    allIds.add(group.id);
  }
  inspectPayload(result);
  return result;
}

/** Validate references/order server-side without transmitting imageMap. */
export function validateAxureTreePlanForSummary(summary: AxureTreeSummary, plan: AxureTreePlan): void {
  const roots: AxureTreeNode[] = [];
  const nodes = new Map<string, AxureTreeNode>();
  for (const source of summary.nodes) {
    const node: AxureTreeNode = { id: source.id, name: source.name, itemType: source.itemType, rect: source.rect };
    nodes.set(node.id, node);
    if (source.parentId === null) { node.scene = { items: [] }; roots.push(node); }
    else nodes.get(source.parentId)!.scene!.items.push(node);
  }
  applyAxureTreePlan({ scene: { items: roots } }, plan);
}
