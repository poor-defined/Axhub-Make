import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { PreviewIframe } from './preview-iframe';
it('keeps the actual iframe ref and load callback while clearing the skeleton for each loaded source', async () => {
  const ref = React.createRef<HTMLIFrameElement>(), frame = {} as HTMLIFrameElement, onLoad = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(PreviewIframe, { src: '/first', title: 'Prototype', ref, onLoad, style: { width: 800, height: 600, transform: 'scale(.5)' } }), { createNodeMock: node => node.type === 'iframe' ? frame : null }); });
  expect(ref.current).toBe(frame);
  expect(view.root.findAllByProps({ 'data-page-skeleton': 'preview' })).toHaveLength(1);
  await act(async () => view.root.findByType('iframe').props.onLoad({ currentTarget: frame }));
  expect(onLoad).toHaveBeenCalledWith({ currentTarget: frame });
  expect(view.root.findAllByProps({ 'data-page-skeleton': 'preview' })).toHaveLength(0);
  // Same-document page/hash navigation does not produce another iframe load event.
  await act(async () => view.update(React.createElement(PreviewIframe, { src: '/first#page=details', title: 'Prototype', ref })));
  expect(view.root.findAllByProps({ 'data-page-skeleton': 'preview' })).toHaveLength(0);
  await act(async () => view.update(React.createElement(PreviewIframe, { src: '/second', title: 'Document', ref, skeletonVariant: 'document' })));
  expect(view.root.findAllByProps({ 'data-page-skeleton': 'document' })).toHaveLength(1);
  await act(async () => view.root.findByType('iframe').props.onError({}));
  expect(view.root.findAllByProps({ 'data-page-skeleton': 'document' })).toHaveLength(0);
  await act(async () => view.unmount());
});
