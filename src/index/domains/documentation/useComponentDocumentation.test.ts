import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useComponentDocumentation } from './useComponentDocumentation';
import { referenceRequest } from './referencePagesClient';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./referencePagesClient', () => ({
  referenceRequest: vi.fn(async () => ({ documents: [] })),
}));
const capture = {
  imageDataUrl: 'data:image/png;base64,aGVsbG8=',
  note: '',
  component: { name: '组件' },
  source: { title: '来源', url: 'http://localhost:53818/' },
};
let view: ReactTestRenderer | undefined;
let api!: ReturnType<typeof useComponentDocumentation>;
function Probe() {
  api = useComponentDocumentation('project-a');
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
});
afterEach(async () => {
  await act(async () => view?.unmount());
  vi.unstubAllGlobals();
});
describe('component documentation capture boundary', () => {
  it('reports malformed external event payloads without opening a broken preview or fetching documents', async () => {
    await act(async () => {
      view = create(React.createElement(Probe));
    });
    await act(async () => {
      const event = new Event('axhub:document-component');
      Object.defineProperty(event, 'detail', {
        value: { imageDataUrl: 'data:text/html,script', component: null },
      });
      window.dispatchEvent(event);
    });
    expect(api.state.phase).toBe('idle');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(referenceRequest).not.toHaveBeenCalled();
  });
  it('accepts valid captures with an empty shared note and loads project documents', async () => {
    await act(async () => {
      view = create(React.createElement(Probe));
    });
    await act(async () => {
      api.open(capture);
    });
    expect(api.state.capture).toEqual(capture);
    expect(api.state.phase).toBe('captured');
    expect(toast.error).not.toHaveBeenCalled();
    expect(referenceRequest).toHaveBeenCalledWith(
      '/api/component-documentation/documents?projectId=project-a',
      expect.anything(),
    );
  });
});
