import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setExportCoreLoaderForTests, exportSelectionToDesignTool } from '../../../vendor/axhub-commentary/src/design-tool-export';

afterEach(() => { __setExportCoreLoaderForTests(null); vi.unstubAllGlobals(); });

function setup() {
  class ExportElement {
    isConnected = true;
    tagName = 'DIV';
    id = 'search-area';
    getAttribute() { return null; }
  }
  vi.stubGlobal('HTMLElement', ExportElement);
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const payload = { scene: { items: [{ id: 'page', itemType: 2 }] } };
  const htmlToAxure = vi.fn(async () => payload);
  __setExportCoreLoaderForTests(async () => ({ htmlToAxure, htmlToFigma: vi.fn(), safeCopyToFigmaWithKiwi: vi.fn() }));
  return { element: new ExportElement() as unknown as Element, writeText, payload, htmlToAxure };
}

describe('selection Axure export workflow', () => {
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
