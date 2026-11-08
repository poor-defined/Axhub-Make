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
  it('selects the PRD skill with slash search and submits an explicit skill token', async () => {
    const onOrganize = vi.fn();
    let view!: ReactTestRenderer;
    await act(async () => { view = create(React.createElement(AxureTreeOrganizationDialog, {
      state: { phase: 'captured', original: { scene: { items: [] } } },
      onOrganize, onCancel: vi.fn(), onRetry: vi.fn(), onCopy: vi.fn(),
    })); });
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: '/PRD' } }));
    const option = view.root.findByProps({ role: 'option' });
    expect(JSON.stringify(option.children)).toContain('PRD 功能拆解与命名');
    await act(async () => option.props.onClick());
    expect(view.root.findByType('textarea').props.value).toContain('$organize-axure-by-prd');
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(onOrganize).toHaveBeenCalledWith('$organize-axure-by-prd');
    await act(async () => view.unmount());
  });
  it('allows explicit original copy during analysis and organized copy only after a validated preview', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const payload = { scene: { items: [{ id: 'page', name: '订单页', itemType: 2,
      rect: { location: { x: 0, y: 0 }, size: { width: 100, height: 100 } }, scene: { items: [] } }] } };
    const onCopy = vi.fn(); const onCancel = vi.fn(); const onRetry = vi.fn(); const onOrganize = vi.fn();
    let renderer!: ReactTestRenderer;
    const render = async (state: AxureOrganizationState) => {
      await act(async () => {
        const view = React.createElement(AxureTreeOrganizationDialog, { state, onCopy, onCancel, onRetry, onOrganize });
        if (renderer) renderer.update(view); else renderer = create(view);
      });
    };
    const button = (label: string) => renderer.root.findAllByType('button')
      .find((item) => item.children.filter((child) => typeof child === 'string').join('') === label)!;
    await render({ phase: 'captured', original: payload });
    expect(button('AI 整理组件树').props.disabled).toBe(false);
    expect(onOrganize).not.toHaveBeenCalled();
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(onOrganize).toHaveBeenCalledWith('');
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

    await render({ phase: 'error', original: payload, error: 'AI unavailable', turns: [{ instruction: '中文命名', status: 'error' }] });
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain('AI unavailable');
    await act(async () => { button('重试本次整理').props.onClick(); button('取消').props.onClick(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.unmount(); });
  });
  it('sends typed naming rules, retains a failed draft and clears it on successful revision or a new session', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const original = { scene: { items: [] } };
    const onOrganize = vi.fn(); const onRetry = vi.fn();
    let renderer!: ReactTestRenderer;
    const render = async (state: AxureOrganizationState) => {
      await act(async () => {
        const view = React.createElement(AxureTreeOrganizationDialog, { state, onOrganize, onRetry, onCopy: vi.fn(), onCancel: vi.fn() });
        if (renderer) renderer.update(view); else renderer = create(view);
      });
    };
    const textarea = () => renderer.root.findByType('textarea');
    await render({ phase: 'ready', original, organized: original, version: 1 });
    await act(async () => { textarea().props.onChange({ target: { value: '按钮使用 btn_ 前缀' } }); });
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(onOrganize).toHaveBeenCalledWith('按钮使用 btn_ 前缀');
    await render({ phase: 'analyzing', original, organized: original, version: 1 });
    expect(textarea().props.disabled).toBe(true);
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(onOrganize).toHaveBeenCalledTimes(1);
    await render({ phase: 'error', original, organized: original, version: 1, error: '断线', turns: [{ instruction: '按钮使用 btn_ 前缀', status: 'error' }] });
    expect(textarea().props.value).toBe('按钮使用 btn_ 前缀');
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(onOrganize).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await render({ phase: 'ready', original, organized: original, version: 2 });
    expect(textarea().props.value).toBe('');
    await render({ phase: 'error', original, organized: original, version: 2, error: '断线', turns: [{ instruction: '上一条要求', status: 'error' }] });
    await act(async () => { textarea().props.onChange({ target: { value: '尚未发送的新草稿' } }); });
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === '重试本次整理')!;
    await act(async () => { retry.props.onClick(); });
    await render({ phase: 'ready', original, organized: original, version: 3 });
    expect(textarea().props.value).toBe('尚未发送的新草稿');
    await act(async () => { textarea().props.onChange({ target: { value: '旧草稿' } }); });
    await render({ phase: 'captured', original: structuredClone(original), version: 0 });
    expect(textarea().props.value).toBe('');
    await act(async () => { renderer.unmount(); });
  });
});
