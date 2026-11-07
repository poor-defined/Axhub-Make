import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, it, expect, vi } from 'vitest';
import ComponentDocumentationDialog from './ComponentDocumentationDialog';
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? React.createElement('div', {}, children) : null),
  DialogContent: 'div',
  DialogHeader: 'div',
  DialogTitle: 'h2',
  DialogDescription: 'p',
  DialogFooter: 'div',
}));
describe('documentation preview', () => {
  it('does not generate automatically and requires a target PRD and editable preview before append', async () => {
    const generate = vi.fn(),
      append = vi.fn(),
      select = vi.fn();
    let view!: ReactTestRenderer;
    const props = {
      state: {
        phase: 'captured' as const,
        documentPath: '',
        title: '',
        description: '',
        capture: {
          imageDataUrl: 'data:image/png;base64,aA==',
          note: '',
          component: { name: '组件' },
          source: { title: '原型', url: 'https://x.test' },
        },
      },
      documents: [{ path: 'docs/prd.md', title: 'PRD' }],
      onSelectDocument: select,
      onEdit: vi.fn(),
      onGenerate: generate,
      onAppend: append,
      onClose: vi.fn(),
    };
    await act(async () => {
      view = create(React.createElement(ComponentDocumentationDialog, props));
    });
    expect(generate).not.toHaveBeenCalled();
    expect(view.root.findByType('img').props.src).toBe(props.state.capture.imageDataUrl);
    const button = (label: string) =>
      view.root.findAllByType('button').find((n) => n.children.includes(label))!;
    expect(button('确认追加到 PRD 末尾').props.disabled).toBe(true);
    expect(button('AI 生成图文').props.disabled).toBe(true);
    await act(async () => {
      view.root
        .findByProps({ 'aria-label': '目标 PRD' })
        .props.onChange({ target: { value: 'docs/prd.md' } });
      view.update(
        React.createElement(ComponentDocumentationDialog, {
          ...props,
          state: { ...props.state, documentPath: 'docs/prd.md' },
        }),
      );
    });
    expect(select).toHaveBeenCalledWith('docs/prd.md');
    expect(button('AI 生成图文').props.disabled).toBe(false);
    await act(async () => {
      button('AI 生成图文').props.onClick();
    });
    expect(generate).toHaveBeenCalledWith('');
    await act(async () => {
      view.update(
        React.createElement(ComponentDocumentationDialog, {
          ...props,
          state: {
            ...props.state,
            phase: 'ready',
            documentPath: 'docs/prd.md',
            title: '组件',
            description: '说明',
          },
        }),
      );
    });
    expect(button('确认追加到 PRD 末尾').props.disabled).toBe(false);
    await act(async () => {
      button('确认追加到 PRD 末尾').props.onClick();
    });
    expect(append).toHaveBeenCalledTimes(1);
    await act(async () => view.unmount());
  });
});
