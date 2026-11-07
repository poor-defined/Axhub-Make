import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconActionButton } from '../../../vendor/axhub-commentary/src/ui/runtime/action-buttons';

describe('named prompt actions', () => {
  it('renders the prototype generation name as visible button content alongside its existing tooltip', () => {
    const html = renderToStaticMarkup(
      React.createElement(IconActionButton, {
        title: '生成当前组件',
        label: 'AI 生成原型',
        icon: React.createElement('span', null, '▶'),
        disabled: false,
        onClick: () => {},
      }),
    );
    expect(html).toContain('AI 生成原型');
    expect(html).toContain('aria-label="生成当前组件"');
    expect(html).toContain('width:auto');
  });
});
