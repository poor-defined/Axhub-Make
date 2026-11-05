import { describe, expect, it } from 'vitest';
import { computePromptCardPosition } from '../../../vendor/axhub-commentary/src/ui/prompt-card-position';
import { sanitizeWebEditorUiSettings } from '../../../vendor/axhub-commentary/src/core/editor/ui-settings';
import { preparePersistedWebEditorUiSettings, readPersistedWebEditorUiSettings } from '../../../vendor/axhub-commentary/src/core/editor/persisted-ui-settings';
import { pushMobileModeOverride } from '../../../vendor/axhub-commentary/src/utils/mobile-detect';

const base = {
  anchorRect: { left: 100, top: 300, width: 80, height: 40 },
  cardWidth: 320,
  cardHeight: 240,
  viewportWidth: 1440,
  viewportHeight: 900,
  propertyPanelEnabled: false,
};

describe('pinned comment card', () => {
  it('stays at the top right when the selected element moves', () => {
    const options = { ...base, pinnedToTopRight: true };
    expect(computePromptCardPosition(options)).toEqual({ left: 1108, top: 12 });
    expect(computePromptCardPosition({
      ...options, anchorRect: { ...base.anchorRect, left: 700, top: 600 },
    })).toEqual({ left: 1108, top: 12 });
  });

  it('reserves space for the property panel', () => {
    expect(computePromptCardPosition({
      ...base, pinnedToTopRight: true, propertyPanelEnabled: true,
    })).toEqual({ left: 824, top: 12 });
  });

  it('keeps the left edge visible in a narrow viewport', () => {
    expect(computePromptCardPosition({
      ...base, pinnedToTopRight: true, viewportWidth: 300,
    })).toEqual({ left: 12, top: 12 });
  });

  it('restores following the element when unpinned', () => {
    expect(computePromptCardPosition({ ...base, pinnedToTopRight: false }))
      .toEqual({ left: 192, top: 200 });
  });

  it('preserves the preference and defaults older settings to unpinned', () => {
    expect(sanitizeWebEditorUiSettings({ promptCardPinnedToTopRight: true })
      .promptCardPinnedToTopRight).toBe(true);
    expect(sanitizeWebEditorUiSettings({}).promptCardPinnedToTopRight).toBe(false);
    expect(sanitizeWebEditorUiSettings(null).promptCardPinnedToTopRight).toBe(false);
    const stored = JSON.stringify(preparePersistedWebEditorUiSettings(
      sanitizeWebEditorUiSettings({ promptCardPinnedToTopRight: true }),
    ));
    expect(readPersistedWebEditorUiSettings(JSON.parse(stored))
      .promptCardPinnedToTopRight).toBe(true);
  });

  it('preserves the mobile bottom layout even with a desktop pin preference', () => {
    const restore = pushMobileModeOverride(true);
    try {
      expect(computePromptCardPosition({ ...base, pinnedToTopRight: true }))
        .toEqual(computePromptCardPosition({ ...base, pinnedToTopRight: false }));
    } finally {
      restore();
    }
  });
});
