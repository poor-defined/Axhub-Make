import { describe, expect, it } from 'vitest';
import { applyAxureTreePlan, buildAxureTreeSummary, parseAxureTreePlan } from './axureTreeOrganization';

function fixture() {
  const layer = (id: string, x: number) => ({
    id, name: 'div', itemType: 1, rotation: 0, opacity: 1,
    rect: { location: { x, y: 20 }, size: { width: 80, height: 30 } },
    text: { paragraphs: [{ inlines: [{ text: id === 'a' ? '查询订单' : '重置' }] }] },
    backgroundFills: [{ image: 'hash', isHash: true }],
  });
  return {
    masters: {}, imageMap: { hash: 'PRIVATE_IMAGE_BASE64' },
    scene: { items: [{
      id: 'page', name: '订单页', itemType: 2,
      rect: { location: { x: 0, y: 0 }, size: { width: 800, height: 600 } },
      scene: { items: [layer('a', 10), layer('b', 110), layer('c', 210)] },
    }] },
  };
}

const plan = {
  version: 1,
  renames: [{ id: 'a', name: '查询按钮' }],
  groups: [{ id: 'ai-group-search', name: '查询操作', parentId: 'page', childIds: ['a', 'b'] }],
};

describe('Axure AI tree organization', () => {
  it('sends bounded semantic summaries without images or rendering styles', () => {
    const summary = buildAxureTreeSummary(fixture());
    expect(summary.nodes.find((node) => node.id === 'a')).toMatchObject({ text: '查询订单', parentId: 'page' });
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE_IMAGE|backgroundFills|isHash/);
  });

  it('groups consecutive siblings and renames without changing original geometry or assets', () => {
    const original = fixture();
    const before = JSON.stringify(original);
    const result = applyAxureTreePlan(original, plan);
    const items = result.scene.items[0].scene!.items;
    expect(items.map((node) => node.id)).toEqual(['ai-group-search', 'c']);
    expect(items[0]).toMatchObject({
      name: '查询操作', itemType: 0, isMask: false,
      rect: { location: { x: 10, y: 20 }, size: { width: 180, height: 30 } },
    });
    expect(items[0].scene!.items[0]).toEqual({ ...original.scene.items[0].scene.items[0], name: '查询按钮' });
    expect(items[0].scene!.items[1]).toEqual(original.scene.items[0].scene.items[1]);
    expect(result.imageMap).toEqual(original.imageMap);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('supports ordered nested groups while keeping the leaf paint sequence', () => {
    const result = applyAxureTreePlan(fixture(), {
      ...plan,
      groups: [...plan.groups, { id: 'ai-group-main', name: '内容区域', parentId: 'page', childIds: ['ai-group-search', 'c'] }],
    });
    const main = result.scene.items[0].scene!.items[0];
    expect(main.scene!.items.map((node) => node.id)).toEqual(['ai-group-search', 'c']);
    expect(main.scene!.items[0].scene!.items.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it.each([
    { ...plan, renames: [{ id: 'unknown', name: '按钮' }] },
    { ...plan, renames: [{ id: 'a', name: '' }] },
    { ...plan, renames: [{ id: 'a', name: 'x'.repeat(81) }] },
    { ...plan, renames: [{ id: 'a', name: '按钮' }, { id: 'a', name: '重复' }] },
    { ...plan, groups: [{ ...plan.groups[0], childIds: ['a', 'c'] }] },
    { ...plan, groups: [{ ...plan.groups[0], childIds: ['b', 'a'] }] },
    { ...plan, groups: [{ ...plan.groups[0], childIds: ['a', 'a'] }] },
    { ...plan, groups: [{ ...plan.groups[0], childIds: [] }] },
    { ...plan, groups: [{ ...plan.groups[0], id: 'a' }] },
    { ...plan, groups: [{ ...plan.groups[0], parentId: 'a' }] },
    { ...plan, groups: [{ ...plan.groups[0], childIds: ['ai-group-search', 'a'] }] },
    { ...plan, groups: [{ ...plan.groups[0], rect: { x: 100 } }] },
  ])('rejects invalid or unsafe operations atomically: %j', (invalid) => {
    const original = fixture();
    const before = JSON.stringify(original);
    expect(() => applyAxureTreePlan(original, invalid)).toThrow();
    expect(JSON.stringify(original)).toBe(before);
  });

  it('protects existing group and mask internals from reparenting or renaming', () => {
    const original: any = fixture();
    original.scene.items[0].scene.items[0].maskedScene = { items: [{
      id: 'inside-mask', name: '内部', itemType: 1,
      rect: { location: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
    }] };
    const summary = buildAxureTreeSummary(original);
    expect(summary.nodes.some((node) => node.id === 'inside-mask')).toBe(false);
    expect(() => applyAxureTreePlan(original, { version: 1, groups: [], renames: [{ id: 'inside-mask', name: '改名' }] })).toThrow();
  });

  it('rejects duplicate node ids and nonfinite geometry before AI', () => {
    const original = fixture();
    original.scene.items[0].scene.items[1].id = 'a';
    expect(() => buildAxureTreeSummary(original)).toThrow();
    original.scene.items[0].scene.items[1].id = 'b';
    original.scene.items[0].scene.items[1].rect.location.x = Infinity;
    expect(() => buildAxureTreeSummary(original)).toThrow();
  });

  it('parses pure or fenced JSON but rejects prose, unsupported versions and unexpected fields', () => {
    expect(parseAxureTreePlan('```json\n' + JSON.stringify(plan) + '\n```')).toEqual(plan);
    expect(() => parseAxureTreePlan('Here is the plan: ' + JSON.stringify(plan))).toThrow();
    expect(() => parseAxureTreePlan(JSON.stringify({ ...plan, version: 2 }))).toThrow();
    expect(() => parseAxureTreePlan(JSON.stringify({ ...plan, code: 'run()' }))).toThrow();
  });

  it('accepts ACP’s known skill-budget diagnostic before JSON without accepting arbitrary warnings', () => {
    const diagnostic = 'Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';
    expect(parseAxureTreePlan(`${diagnostic}\n\n${JSON.stringify(plan)}`)).toEqual(plan);
    expect(() => parseAxureTreePlan(`Warning: sandbox disabled\n${JSON.stringify(plan)}`)).toThrow();
  });

  it('bounds large input and rejects malformed trees', () => {
    const original = fixture();
    original.scene.items[0].scene.items = Array.from({ length: 2001 }, (_, i) => ({ ...original.scene.items[0].scene.items[0], id: String(i) }));
    expect(() => buildAxureTreeSummary(original)).toThrow();
    expect(() => buildAxureTreeSummary({ scene: { items: [] } })).toThrow();
  });
});
