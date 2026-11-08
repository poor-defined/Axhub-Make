import { expect, it } from 'vitest';
import { validateAxurePrdMarkers } from './axurePrdMarkers';
import type { AxureTreeSummary } from './axureTreeOrganization';
const summary = { version: 1, nodes: [{ id: 'a', name: '首屏 [prd:cfd-f02-hero]' }, { id: 'b', name: '活动' }] } as AxureTreeSummary;
it('rejects lost existing markers and duplicated markers, and permits distinct copied component markers', () => {
  expect(() => validateAxurePrdMarkers(summary, { version: 1, renames: [{ id: 'a', name: '首屏' }], groups: [] })).toThrow(/保留/);
  expect(() => validateAxurePrdMarkers(summary, { version: 1, renames: [{ id: 'b', name: '复制 [prd:cfd-f02-hero]' }], groups: [] })).toThrow(/重复/);
  expect(() => validateAxurePrdMarkers(summary, { version: 1, renames: [{ id: 'b', name: '复制 [prd:cfd-f02-hero-copy-01]' }], groups: [] })).not.toThrow();
});
it('rejects malformed identifiers and does not interpret unseen dynamic panel or repeater children as duplicates', () => {
  expect(() => validateAxurePrdMarkers(summary, { version: 1, renames: [{ id: 'b', name: '活动 [prd:中文]' }], groups: [] })).toThrow(/标记/);
  expect(() => validateAxurePrdMarkers(summary, { version: 1, renames: [], groups: [] })).not.toThrow();
});
it('keeps the first source instance marker when correcting copied component conflicts', () => {
  const duplicated = { ...summary, nodes: [summary.nodes[0], { ...summary.nodes[1], name: '副本 [prd:cfd-f02-hero]' }] };
  expect(() => validateAxurePrdMarkers(duplicated, { version: 1, renames: [{ id: 'a', name: '首屏 [prd:cfd-f02-hero-copy-01]' }], groups: [] })).toThrow(/保留/);
  expect(() => validateAxurePrdMarkers(duplicated, { version: 1, renames: [{ id: 'b', name: '副本' }], groups: [] })).toThrow(/标记/);
  expect(() => validateAxurePrdMarkers(duplicated, { version: 1, renames: [{ id: 'b', name: '副本 [prd:cfd-f02-hero-copy-01]' }], groups: [] })).not.toThrow();
});
