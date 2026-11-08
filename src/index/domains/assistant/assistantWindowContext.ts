import type { AssistantContextV1 } from '@/common/assistant-context/types';
import { buildAcpContextPostMessage, buildAcpContextItemsPostMessage, WIREFRAME_CONTEXT_POLICY_ID } from './assistantAcpContext';

/** ACP stores context in memory: probe after reload, adding only a missing project policy. */
export function maintainAssistantWindowPolicy(targetWindow: Window, targetOrigin: string): () => void {
  let stopped = false;
  let timer: ReturnType<typeof window.setTimeout> | undefined;
  let requestId = '';
  let sequence = 0;
  const prefix = `acp-window-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('pagehide', stop);
  };
  const onMessage = (event: MessageEvent) => {
    if (stopped || event.source !== targetWindow || event.origin !== targetOrigin) return;
    const response = event.data;
    if (response?.requestId !== requestId || response.type !== 'acp.context.result') return;
    const items = response.payload?.context?.items;
    if (!Array.isArray(items) || items.some((item) => item?.id === WIREFRAME_CONTEXT_POLICY_ID)) return;
    try {
      targetWindow.postMessage(buildAcpContextItemsPostMessage([], 'append', `${requestId}-restore`), targetOrigin);
    } catch { stop(); }
  };
  const probe = () => {
    if (stopped) return;
    if (targetWindow.closed) { stop(); return; }
    requestId = `${prefix}-${++sequence}`;
    try {
      targetWindow.postMessage({ type: 'acp.context.get', requestId, payload: {} }, targetOrigin);
    } catch { stop(); return; }
    timer = window.setTimeout(probe, 2000);
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', stop);
  probe();
  return stop;
}

/** Keep retrying through a child window's cold start; only its matching ACK confirms delivery. */
export function syncAssistantWindowContext(
  targetWindow: Window,
  targetOrigin: string,
  context: AssistantContextV1 | null | undefined,
): Promise<void> {
  const requestId = `acp-window-context-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const request = buildAcpContextPostMessage(context, 'replace', requestId);
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer: ReturnType<typeof window.setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof window.setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(retryTimer);
      window.clearTimeout(timeoutTimer);
      if (error) reject(error); else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow || event.origin !== targetOrigin) return;
      if (event.data?.requestId !== requestId) return;
      if (event.data.type === 'acp.context.result') finish();
      if (event.data.type === 'acp.context.error') finish(new Error('AI 助手上下文同步失败'));
    };
    const send = () => {
      if (settled) return;
      if (targetWindow.closed) { finish(new Error('AI 助手窗口已关闭')); return; }
      try {
        targetWindow.postMessage(request, targetOrigin);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
      if (!settled) retryTimer = window.setTimeout(send, 500);
    };
    window.addEventListener('message', onMessage);
    timeoutTimer = window.setTimeout(() => finish(new Error('AI 助手上下文同步超时')), 30_000);
    send();
  });
}
