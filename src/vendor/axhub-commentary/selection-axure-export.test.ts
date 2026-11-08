import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setExportCoreLoaderForTests, exportSelectionToDesignTool } from '../../../vendor/axhub-commentary/src/design-tool-export';

afterEach(() => { __setExportCoreLoaderForTests(null); vi.unstubAllGlobals(); });

function setup() {
  class ExportElement {
    isConnected = true;
    tagName = 'DIV';
    id = 'search-area';
    getAttribute() { return null; }
    ownerDocument = {};
    textContent = '';
    rect = { left: 0, top: 0, width: 80, height: 30 };
    getBoundingClientRect() { return this.rect; }
    contains(other: unknown) { return other === this; }
    order = 0;
    compareDocumentPosition(other: ExportElement) { return this.order < other.order ? 4 : 2; }
  }
  vi.stubGlobal('HTMLElement', ExportElement);
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const payload = { scene: { items: [{ id: 'page', itemType: 2, scene: { items: [{ id: 'selected-layer' }] } }] } };
  const htmlToAxure = vi.fn(async (_target?: string | HTMLElement, _options?: unknown): Promise<unknown> => payload);
  __setExportCoreLoaderForTests(async () => ({ htmlToAxure, htmlToFigma: vi.fn(), safeCopyToFigmaWithKiwi: vi.fn() }));
  return { element: new ExportElement() as unknown as Element, writeText, payload, htmlToAxure };
}

describe('selection Axure export workflow', () => {
  it('aborts when a selected member has no visible exportable output', async () => {
    const { element, htmlToAxure, writeText } = setup();
    htmlToAxure.mockResolvedValue({ scene: { items: [{ itemType: 2, scene: { items: [] } }] } });
    const prepareAxureExport = vi.fn(async () => true);
    await expect(exportSelectionToDesignTool('axure', element, { prepareAxureExport })).rejects.toThrow(/可导出/);
    expect(prepareAxureExport).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
  });
  it('detects descendant layout changes even when the selected container keeps its bounds and text', async () => {
    const { element, htmlToAxure, payload } = setup();
    const child = new (element.constructor as new () => any)();
    element.querySelectorAll = (() => [child]) as any;
    htmlToAxure.mockImplementation(async () => { child.rect.left += 10; return payload; });
    await expect(exportSelectionToDesignTool('axure', element)).rejects.toThrow(/变化/);
  });
  it('takes the selection geometry snapshot before asynchronously loading the collector', async () => {
    const { element, htmlToAxure } = setup();
    __setExportCoreLoaderForTests(async () => {
      (element as any).rect.left += 10;
      return { htmlToAxure, htmlToFigma: vi.fn(), safeCopyToFigmaWithKiwi: vi.fn() };
    });
    await expect(exportSelectionToDesignTool('axure', element)).rejects.toThrow(/变化/);
    expect(htmlToAxure).not.toHaveBeenCalled();
  });
  it('deduplicates internal SVG geometry covered by an explicitly selected SVG container', async () => {
    const { element, htmlToAxure } = setup();
    class Svg extends (element.constructor as new () => any) { ownerSVGElement: unknown = null; }
    vi.stubGlobal('SVGElement', Svg);
    const svg = new Svg(), path = new Svg(); path.ownerSVGElement = svg;
    svg.ownerDocument = path.ownerDocument = element.ownerDocument;
    svg.contains = (other: unknown) => other === svg || other === path;
    await exportSelectionToDesignTool('axure', [svg, path] as any);
    expect(htmlToAxure).toHaveBeenCalledTimes(1);
  });
  it('blocks SVG geometry roots instead of silently exporting an empty board or including unselected siblings', async () => {
    const { element, htmlToAxure } = setup();
    class SvgElement extends (element.constructor as new () => any) { ownerSVGElement = {}; }
    vi.stubGlobal('SVGElement', SvgElement);
    const path = new SvgElement(); path.ownerDocument = element.ownerDocument;
    await expect(exportSelectionToDesignTool('axure', [element, path] as any)).rejects.toThrow(/SVG.*容器/);
    expect(htmlToAxure).not.toHaveBeenCalled();
  });
  it('captures only every selected root, merges relative coordinates/resources and rekeys colliding IDs', async () => {
    const { element, htmlToAxure } = setup();
    const second = new (element.constructor as new () => any)();
    second.ownerDocument = element.ownerDocument;
    second.id = 'reset'; second.order = 1; second.rect = { left: 120, top: 50, width: 40, height: 20 };
    const node = (name: string) => ({ id: '1-10', name, itemType: 1, rect: { location: { x: 5, y: 6 }, size: { width: 10, height: 10 } },
      backgroundFills: [{ image: 'shared', isHash: true }], maskedScene: { items: [{ id: '1-11', itemType: 1, name: 'SVG', rect: { location: { x: 7, y: 8 }, size: { width: 5, height: 5 } } }] } });
    htmlToAxure.mockImplementation(async (target?: unknown) => ({ masters: {}, imageMap: { shared: 'image-data' }, scene: { items: [{
      id: '1-12', itemType: 2, name: 'page', rect: { location: target === element ? { x: 0, y: 0 } : { x: 120, y: 50 }, size: { width: 80, height: 30 } },
      backgroundShape: { id: '1-13', backgroundFills: [{ enabled: true }] }, scene: { items: [node(target === element ? 'Search' : 'Reset')] },
    }] } }) as any);
    const prepareAxureExport = vi.fn(async (_payload: unknown) => true);
    await exportSelectionToDesignTool('axure', [element, second] as any, { prepareAxureExport });
    expect(htmlToAxure.mock.calls.map(([target]) => target)).toEqual([element, second]);
    const payload = prepareAxureExport.mock.calls[0][0] as any;
    expect(payload.scene.items).toHaveLength(1);
    const board = payload.scene.items[0];
    expect(board.rect.size).toEqual({ width: 160, height: 70 });
    expect(board.scene.items.map((item: any) => item.name)).toEqual(['Search', 'Reset']);
    expect(board.scene.items.map((item: any) => item.rect.location)).toEqual([{ x: 5, y: 6 }, { x: 125, y: 56 }]);
    expect(board.scene.items[1].maskedScene.items[0].rect.location).toEqual({ x: 127, y: 58 });
    expect(board.scene.items[0].id).not.toBe(board.scene.items[1].id);
    expect(payload.imageMap).toEqual({ shared: 'image-data' });
    expect(board.backgroundShape.backgroundFills.every((fill: any) => !fill.enabled)).toBe(true);
  });
  it('removes descendant and duplicate selection roots while keeping a selected container intact', async () => {
    const { element: parent, htmlToAxure } = setup();
    const child = new (parent.constructor as new () => any)(); child.ownerDocument = parent.ownerDocument;
    parent.contains = (other) => other === parent || other === child;
    await exportSelectionToDesignTool('axure', [child, parent, parent] as any);
    expect(htmlToAxure).toHaveBeenCalledTimes(1);
    expect(htmlToAxure.mock.calls[0][0]).toBe(parent);
  });
  it('rejects the entire selection if any member is stale, without exporting a surviving subset', async () => {
    const { element, htmlToAxure } = setup();
    const stale = new (element.constructor as new () => any)(); stale.isConnected = false;
    await expect(exportSelectionToDesignTool('axure', [element, stale] as any)).rejects.toThrow(/失效/);
    expect(htmlToAxure).not.toHaveBeenCalled();
  });
  it('does not prepare/copy if a target moves during capture', async () => {
    const { element, htmlToAxure, payload, writeText } = setup();
    htmlToAxure.mockImplementation(async () => { (element as any).rect.left += 10; return payload; });
    const prepareAxureExport = vi.fn(async () => true);
    await expect(exportSelectionToDesignTool('axure', element, { prepareAxureExport })).rejects.toThrow(/变化/);
    expect(prepareAxureExport).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
  });
  it('routes selected-element output to the host preview instead of silently copying raw JSON', async () => {
    const { element, payload, writeText } = setup();
    const prepareAxureExport = vi.fn(async () => true);
    await exportSelectionToDesignTool('axure', element, { prepareAxureExport });
    expect(prepareAxureExport).toHaveBeenCalledWith(payload);
    expect(writeText).not.toHaveBeenCalled();
  });
  it('does not silently copy if the host cannot open the preparation step', async () => {
    const { element, writeText } = setup();
    await expect(exportSelectionToDesignTool('axure', element, { prepareAxureExport: async () => false })).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });
  it('preserves standalone selection export when no Make host is present', async () => {
    const { element, payload, writeText } = setup();
    await exportSelectionToDesignTool('axure', element);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(payload));
  });
});
