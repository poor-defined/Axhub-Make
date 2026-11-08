import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import PrdImageRenameDialog from './PrdImageRenameDialog';
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, children }: any) => open ? React.createElement('div', {}, children) : null, DialogContent: 'div', DialogHeader: 'div', DialogTitle: 'h2', DialogDescription: 'p', DialogFooter: 'div' }));
afterEach(() => vi.unstubAllGlobals());
it('previews first and changes files only after explicit confirmation', async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => Response.json(options?.method === 'POST' ? { backupDirectory: '/backup', renamed: 1 } : { digest: 'approved-plan', documentCount: 1, referenceCount: 2, warnings: [], items: [{ documentPath: '/docs/PRD.md', from: 'image 4.png', to: 'cfd-f02-hero.png', label: 'F02 首屏', references: 1 }] }));
  vi.stubGlobal('fetch', fetcher);
  const onDone = vi.fn(); let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(PrdImageRenameDialog, { open: true, projectId: 'p', onDone })); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(view.toJSON())).toContain('cfd-f02-hero.png');
  const confirm = view.root.findAllByType('button').find(button => button.children.includes('确认批量修改'))!;
  await act(async () => confirm.props.onClick());
  expect(fetcher).toHaveBeenLastCalledWith('/api/prd-images/apply?projectId=p', expect.objectContaining({ method: 'POST', body: JSON.stringify({ digest: 'approved-plan' }) }));
  expect(JSON.stringify(view.toJSON())).toContain('/backup');
  await act(async () => view.unmount());
});
