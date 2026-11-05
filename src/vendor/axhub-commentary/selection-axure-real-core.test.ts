import { afterEach, expect, it, vi } from 'vitest';
import { exportSelectionToDesignTool } from '../../../vendor/axhub-commentary/src/design-tool-export';
import { buildAxureTreeSummary, applyAxureTreePlan } from '../../common/axureTreeOrganization';
import { htmlToAxure } from 'axhub-export-core';
import { writeFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());

/** Minimal DOM contract for the shipped collector: the collector and payload serializer are real. */
function dom() {
  const style = new Proxy({ display: 'block', visibility: 'visible', opacity: '1', backgroundColor: 'rgb(238, 238, 238)',
    backgroundImage: 'none', position: 'static', zIndex: 'auto', transform: 'none', filter: 'none', isolation: 'auto', float: 'none',
  }, { get: (target, key) => Reflect.get(target, key) ?? '' });
  class HtmlElement {
    isConnected = true;
    tagName = 'DIV'; nodeType = 1; childNodes: unknown[] = []; children: unknown[] = [];
    parentElement = null; textContent = ''; style = { getPropertyValue: () => '' };
    clientWidth = 80; clientHeight = 30; scrollWidth = 80; scrollHeight = 30;
    ownerDocument: any;
    constructor(public id: string, public left: number, public top: number, public order: number) {}
    getAttribute(name: string) { return name === 'id' ? this.id : null; }
    hasAttribute() { return false; }
    querySelectorAll() { return []; }
    matches() { return false; }
    closest() { return null; }
    contains(other: unknown) { return other === this; }
    compareDocumentPosition(other: HtmlElement) { return this.order < other.order ? 4 : 2; }
    getBoundingClientRect() { return { x: this.left, y: this.top, left: this.left, top: this.top, width: 80, height: 30, right: this.left + 80, bottom: this.top + 30 }; }
  }
  const window = { scrollX: 0, scrollY: 0, getComputedStyle: () => style };
  const body = new HtmlElement('body', 0, 0, 0);
  const document = { body, documentElement: body, title: 'fixture', baseURI: 'http://fixture.test/', defaultView: window,
    createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [],
  };
  body.ownerDocument = document;
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLElement', HtmlElement); vi.stubGlobal('Element', HtmlElement);
  vi.stubGlobal('SVGElement', class {});
  vi.stubGlobal('Node', { ELEMENT_NODE: 1, TEXT_NODE: 3 });
  vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3, FILTER_REJECT: 2 });
  const first = new HtmlElement('selected-search', 100, 200, 1), second = new HtmlElement('selected-reset', 250, 210, 2);
  first.ownerDocument = second.ownerDocument = document;
  return { first, second };
}

it('merges real htmlToAxure captures into a valid editable selection snapshot for the existing AI pipeline', async () => {
  const { first, second } = dom();
  let payload: unknown;
  await exportSelectionToDesignTool('axure', [second, first] as unknown as Element[], {
    prepareAxureExport: async (value) => { payload = value; return true; },
  });
  const summary = buildAxureTreeSummary(payload);
  expect(summary.nodes).toHaveLength(3);
  expect(summary.nodes[0].rect.size).toEqual({ width: 230, height: 40 });
  expect(summary.nodes.slice(1).map((node) => node.rect.location)).toEqual([{ x: 0, y: 0 }, { x: 150, y: 10 }]);
  expect(new Set(summary.nodes.map((node) => node.id)).size).toBe(3);
  const organized = applyAxureTreePlan(payload, { version: 1, renames: [{ id: summary.nodes[1].id, name: '查询按钮' }],
    groups: [{ id: 'ai-group-selected-actions', parentId: summary.nodes[0].id, name: '选中操作', childIds: summary.nodes.slice(1).map((node) => node.id) }] });
  expect(organized.scene.items[0].scene?.items).toHaveLength(1);
  expect(organized.scene.items[0].scene?.items[0].scene?.items).toHaveLength(2);
  // Opt-in artifact for native Axure Bridge/paste verification; no clipboard writes in the test suite.
  if (process.env.REQ009_SMOKE_OUTPUT) writeFileSync(process.env.REQ009_SMOKE_OUTPUT, JSON.stringify(organized));
});

it('demonstrates and blocks the real collectors empty-output behavior for internal SVG geometry', async () => {
  const { first } = dom();
  class SvgGeometry extends (first.constructor as new (...args: any[]) => any) { ownerSVGElement = {}; }
  vi.stubGlobal('SVGElement', SvgGeometry);
  const path = new SvgGeometry('path', 0, 0, 0); path.ownerDocument = first.ownerDocument;
  const raw = await htmlToAxure(path as unknown as HTMLElement);
  expect(raw.scene.items[0].scene.items).toHaveLength(0);
  await expect(exportSelectionToDesignTool('axure', path as unknown as Element)).rejects.toThrow(/SVG.*容器/);
});
