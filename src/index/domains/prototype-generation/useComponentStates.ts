import React from 'react';
import { toast } from 'sonner';
import { resolveAcpPromptClientProvider } from '../../../common/acpModelConfig';
import type { PromptClientPreference } from '../../types';
import { referenceRequest } from '../documentation/referencePagesClient';
import { runAcpPrototypeAgent } from './acpPrototypeAgentClient';
import { createComponentStatesSession, type ComponentStatesPrototype } from './componentStatesSession';
export function useComponentStates(projectId: string | null, options: {
  promptClient: PromptClientPreference; model?: string | null;
  onDone: (prepared: ComponentStatesPrototype) => void | Promise<void>;
  onOpen: (prepared: ComponentStatesPrototype) => void;
}) {
  const latest = React.useRef(options); latest.current = options;
  const activeProject = React.useRef(projectId); activeProject.current = projectId;
  const notification = React.useRef<string | number | undefined>();
  const [session] = React.useState(() => createComponentStatesSession({
    prepare: async (request, scope) => {
      if (!resolveAcpPromptClientProvider(latest.current.promptClient)) throw new Error('请先在项目设置中配置批注 AI');
      return referenceRequest(`/api/prototypes/create-component-states?projectId=${encodeURIComponent(scope)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    },
    run: async (prepared, request, scope, progress) => {
      const provider = resolveAcpPromptClientProvider(latest.current.promptClient);
      if (!provider) throw new Error('请先在项目设置中配置批注 AI');
      const result = await runAcpPrototypeAgent({ projectId: scope, provider, model: latest.current.model,
        generatorElementId: `component-states-${prepared.name}`, targetPath: `prototypes/${prepared.name}`,
        currentPrototype: { name: prepared.name, displayName: prepared.displayName },
        prototypeDirectory: prepared.filePath.replace(/\/[^/]+$/u, '/'),
        prompt: prepared.prompt, referenceImages: [request.capture.imageDataUrl],
        onEvent: event => { if (event.message) progress(event.message); },
      });
      if (result.status !== 'done') throw new Error(result.error || 'AI 生成失败');
    },
    onDone: async (prepared, scope) => {
      if (activeProject.current !== scope) return;
      await latest.current.onDone(prepared);
      if (activeProject.current !== scope) return;
      notification.current = toast.success('组件状态生成任务已完成', { id: notification.current, action: { label: '打开原型', onClick: () => { if (activeProject.current === scope) latest.current.onOpen(prepared); } } });
    },
  }));
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  React.useEffect(() => {
    session.reset();
    return () => { session.reset(); if (notification.current !== undefined) toast.dismiss(notification.current); };
  }, [projectId, session]);
  React.useEffect(() => {
    if (state.visible || state.projectId !== activeProject.current) return;
    const action = { label: '查看进度', onClick: () => { if (activeProject.current === state.projectId) session.show(); } };
    if (state.phase === 'preparing' || state.phase === 'running') notification.current = toast.loading('正在生成组件状态原型…', { id: notification.current, action });
    else if (state.phase === 'error') notification.current = toast.error(state.error, { id: notification.current, action: { ...action, label: '查看并重试' } });
  }, [state.visible, state.phase, state.projectId, state.error, session]);
  React.useEffect(() => {
    const listener = (event: Event) => {
      try {
        if (!projectId || !session.open(projectId, (event as CustomEvent).detail)) {
          event.preventDefault(); session.show(); toast.info('请先处理当前组件状态任务');
        }
      } catch (error) { event.preventDefault(); toast.error(error instanceof Error ? error.message : '组件状态数据无效'); }
    };
    window.addEventListener('axhub:generate-component-states', listener);
    return () => window.removeEventListener('axhub:generate-component-states', listener);
  }, [projectId, session]);
  return { state, session, openPrototype: () => { if (state.prepared && state.projectId === activeProject.current) { latest.current.onOpen(state.prepared); session.close(); } } };
}
