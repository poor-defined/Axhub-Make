import { afterEach, describe, expect, it, vi } from 'vitest';

import { readExportModalPreferences } from './exportModalPreferences';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportModalPreferences', () => {
  it('ignores obsolete automatic AI settings while keeping capture preferences', () => {
    let stored = JSON.stringify({ version: 1, axureCopyOptions: { preserveHierarchy: true, preserveSvgIcons: true } });
    vi.stubGlobal('window', { localStorage: { getItem: () => stored } });
    expect(readExportModalPreferences('test').axureCopyOptions).toEqual({ preserveHierarchy: true, preserveSvgIcons: true });
    stored = JSON.stringify({ version: 1, axureCopyOptions: { aiOrganize: true, preserveHierarchy: false, preserveSvgIcons: true } });
    expect(readExportModalPreferences('test').axureCopyOptions).toEqual({ preserveHierarchy: false, preserveSvgIcons: true });
    stored = JSON.stringify({ version: 1, axureCopyOptions: { aiOrganize: false } });
    expect(readExportModalPreferences('test').axureCopyOptions).toBeUndefined();
  });
  it('defaults legacy Axure export preferences to including image assets', () => {
    const storedValue = JSON.stringify({
      version: 1,
      imageConfig: {
        width: 500,
        height: 300,
        includeConfig: 'code',
        contentType: 'title',
        isFullScreen: true,
      },
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => storedValue),
      },
    });

    const preferences = readExportModalPreferences('test-export-preferences');

    expect(preferences.imageConfig?.includeImageAssets).toBe(true);
  });

  it('preserves an explicit preference to exclude image assets', () => {
    const storedValue = JSON.stringify({
      version: 1,
      imageConfig: {
        width: 500,
        height: 300,
        includeConfig: 'code',
        includeImageAssets: false,
        contentType: 'title',
        isFullScreen: true,
      },
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => storedValue),
      },
    });

    const preferences = readExportModalPreferences('test-export-preferences');

    expect(preferences.imageConfig?.includeImageAssets).toBe(false);
  });
});
