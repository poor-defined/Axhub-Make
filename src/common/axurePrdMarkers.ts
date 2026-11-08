import type { AxureTreePlan, AxureTreeSummary } from './axureTreeOrganization';
function marker(name: string): string | undefined {
  const matches = [...name.matchAll(/\[prd:([a-z0-9]+(?:-[a-z0-9]+)*)\]/gu)];
  if ((name.match(/\[prd:/gu) || []).length !== matches.length || matches.length > 1) throw new Error('PRD 标记格式无效：每个组件名称最多包含一个 [prd:小写业务标识]');
  return matches[0]?.[1];
}
/** Check source nodes only; runtime repeater instances are not independent source markers. */
export function validateAxurePrdMarkers(summary: AxureTreeSummary, plan: AxureTreePlan): void {
  const original = new Map<string, string>();
  for (const node of summary.nodes) {
    const value = marker(node.name);
    if (value && !original.has(value)) original.set(value, node.id);
  }
  const renames = new Map(plan.renames.map(rename => [rename.id, rename.name]));
  const seen = new Set<string>();
  for (const node of [...summary.nodes, ...plan.groups]) {
    const name = renames.get(node.id) || node.name;
    const value = marker(name);
    const previous = summary.nodes.some(item => item.id === node.id) ? marker(node.name) : undefined;
    if (previous && original.get(previous) === node.id && value !== previous) throw new Error(`必须保留原实例的 PRD 标记：[prd:${previous}]`);
    if (previous && !value) throw new Error('复制组件必须分配独立 PRD 标记，不能删除原有标记');
    if (value && seen.has(value)) throw new Error(`PRD 标记重复：[prd:${value}]，请为复制组件分配不同标记`);
    if (value) seen.add(value);
  }
  for (const value of original.keys()) {
    if (!seen.has(value)) throw new Error(`必须至少保留一个原有 PRD 标记：[prd:${value}]`);
  }
}
