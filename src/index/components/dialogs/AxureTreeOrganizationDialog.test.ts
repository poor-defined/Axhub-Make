import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AxureTreeOrganizationDialog from './AxureTreeOrganizationDialog';
import type { AxureOrganizationState } from '../../domains/export/axureOrganizationSession';

// Exercise the feature's controls without requiring a browser portal implementation.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement('div', {}, children) : null,
  DialogContent: 'div', DialogHeader: 'div', DialogTitle: 'h2', DialogDescription: 'p', DialogFooter: 'div',
}));
afterEach(() => { vi.unstubAllGlobals(); });

describe('Axure tree preview controls', () => {
  it('allows explicit original copy during analysis and organized copy only after a validated preview', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const payload = { scene: { items: [{ id: 'page', name: '订单页', itemType: 2,
      rect: { location: { x: 0, y: 0 }, size: { width: 100, height: 100 } }, scene: { items: [] } }] } };
    const onCopy = vi.fn(); const onCancel = vi.fn(); const onRetry = vi.fn();
    let renderer!: ReactTestRenderer;
    const render = async (state: AxureOrganizationState) => {
      await act(async () => {
        const view = React.createElement(AxureTreeOrganizationDialog, { state, onCopy, onCancel, onRetry });
        if (renderer) renderer.update(view); else renderer = create(view);
      });
    };
    const button = (label: string) => renderer.root.findAllByType('button')
      .find((item) => item.children.filter((child) => typeof child === 'string').join('') === label)!;
    await render({ phase: 'captured', original: payload });
    expect(button('AI 整理组件树').props.disabled).toBe(false);
    await act(async () => { button('AI 整理组件树').props.onClick(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    onRetry.mockClear();
    await render({ phase: 'analyzing', original: payload });
    expect(button('复制整理后的结构').props.disabled).toBe(true);
    expect(button('复制原始结构').props.disabled).toBe(false);
    await act(async () => { button('复制原始结构').props.onClick(); });
    expect(onCopy).toHaveBeenCalledWith('original');

    await render({ phase: 'ready', original: payload, organized: payload, plan: { version: 1, renames: [], groups: [] } });
    expect(button('复制整理后的结构').props.disabled).toBe(false);
    await act(async () => { button('复制整理后的结构').props.onClick(); });
    expect(onCopy).toHaveBeenLastCalledWith('organized');

    await render({ phase: 'error', original: payload, error: 'AI unavailable' });
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('AI unavailable');
    await act(async () => { button('重试 AI 整理').props.onClick(); button('取消').props.onClick(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.unmount(); });
  });
});
