import React from 'react';
import { toast } from 'sonner';
import { resolveAcpPromptClientProvider } from '../../../common/acpModelConfig';
import type { PromptClientPreference } from '../../types';
import { referenceRequest } from '../documentation/referencePagesClient';
import { runAcpPrototypeAgent } from './acpPrototypeAgentClient';
import { createScreenshotPrototypeSession, type ScreenshotPrototype, type ScreenshotPrototypeState } from './screenshotPrototypeSession';

const emptyState: ScreenshotPrototypeState = { phase: 'idle', projectId: '', request: null, prepared: null, error: '', message: '' };

export interface ScreenshotPrototypeController {
  state: ScreenshotPrototypeState;
  generate: (input: unknown) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  openPrototype: () => void;
}

export function useScreenshotPrototype(projectId: string | null, options: {
  promptClient: PromptClientPreference; model?: string | null;
  autoOpen?: boolean;
  onDone: (prepared: ScreenshotPrototype) => void | Promise<void>;
  onOpen: (prepared: ScreenshotPrototype) => void;
}): ScreenshotPrototypeController {
  const latest = React.useRef(options); latest.current = options;
  const activeProject = React.useRef(projectId); activeProject.current = projectId;
  const notification = React.useRef<string | number | undefined>();
  const [session] = React.useState(() => createScreenshotPrototypeSession({
    prepare: async (request, scope) => {
      if (!resolveAcpPromptClientProvider(latest.current.promptClient)) throw new Error('请先在项目 AI 设置中配置对话 AI，再生成原型');
      return referenceRequest<ScreenshotPrototype>(`/api/prototypes/create-from-screenshot?projectId=${encodeURIComponent(scope)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    },
    run: async (prepared, request, scope, progress) => {
      const provider = resolveAcpPromptClientProvider(latest.current.promptClient);
      if (!provider) throw new Error('请先在项目 AI 设置中配置对话 AI，再生成原型');
      const result = await runAcpPrototypeAgent({ projectId: scope, provider, model: latest.current.model,
        generatorElementId: `screenshot-${prepared.name}`, targetPath: `prototypes/${prepared.name}`,
        currentPrototype: { name: prepared.name, displayName: prepared.displayName },
        prototypeDirectory: prepared.filePath.replace(/\/[^/]+$/u, '/'),
        prompt: prepared.prompt, referenceImages: request.images.map(image => image.dataUrl),
        onEvent: event => { if (event.message) progress(event.message); },
      });
      if (result.status !== 'done') throw new Error(result.error || 'AI 生成失败');
    },
    onDone: async (prepared, scope) => {
      if (activeProject.current !== scope) return;
      try {
        await latest.current.onDone(prepared);
        if (activeProject.current === scope && latest.current.autoOpen) latest.current.onOpen(prepared);
      }
      finally {
        if (activeProject.current === scope) notification.current = toast.success('截图原型已生成', { id: notification.current, action: { label: '打开原型', onClick: () => { if (activeProject.current === scope) latest.current.onOpen(prepared); } } });
      }
    },
  }));
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  React.useEffect(() => {
    session.reset();
    return () => { session.reset(); if (notification.current !== undefined) toast.dismiss(notification.current); notification.current = undefined; };
  }, [projectId, session]);
  React.useEffect(() => {
    if (state.projectId !== activeProject.current) return;
    if (state.phase === 'preparing' || state.phase === 'running') notification.current = toast.loading('正在从截图生成原型…', { id: notification.current });
    else if (state.phase === 'error') notification.current = toast.error(state.error, { id: notification.current, action: { label: '重试', onClick: () => { if (activeProject.current === state.projectId) void session.retry(); } } });
  }, [state.phase, state.projectId, state.error, session]);
  return {
    // A new project's first render precedes the reset effect. Never expose the old request to its composer.
    state: state.projectId && state.projectId !== projectId ? emptyState : state,
    generate: input => session.generate(projectId || '', input), retry: session.retry,
    reset: () => { session.reset(); if (notification.current !== undefined) toast.dismiss(notification.current); },
    openPrototype: () => { if (state.prepared && state.projectId === activeProject.current) latest.current.onOpen(state.prepared); },
  };
}
