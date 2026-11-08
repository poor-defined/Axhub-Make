import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AxureTreePayload, AxureTreeSummary, AxureOrganizationContext } from '../../../common/axureTreeOrganization';
import { withProjectScope } from '../../services/projectScope';
import { createAxureOrganizationSession, type AxureOrganizationState } from './axureOrganizationSession';

export async function requestAxureTreeOrganization(projectId: string, summary: AxureTreeSummary, signal: AbortSignal, context?: AxureOrganizationContext): Promise<unknown> {
  const response = await fetch(withProjectScope('/api/axure/organize', { projectId }), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, context }), signal: AbortSignal.any([signal, AbortSignal.timeout(130_000)]),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `AI 整理失败（${response.status}）`);
  return body.plan;
}

export function useAxureTreeOrganization(options: {
  projectId: string;
  scopeKey: string;
  getPreviewIframe: () => HTMLIFrameElement | null;
  getPreviewIframes?: () => HTMLIFrameElement[];
  copy: (payload: AxureTreePayload, signal: AbortSignal) => Promise<void>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<AxureOrganizationState>({ phase: 'idle' });
  const [session] = useState(() => createAxureOrganizationSession({
    analyze: (summary, signal, context) => requestAxureTreeOrganization(latest.current.projectId, summary, signal, context),
    copy: (payload, signal) => latest.current.copy(payload, signal),
    onChange: setState,
  }));
  useLayoutEffect(() => { session.setScope(options.scopeKey); }, [session, options.scopeKey]);
  useEffect(() => {
    const iframes = options.getPreviewIframes?.() ?? [options.getPreviewIframe()].filter(Boolean) as HTMLIFrameElement[];
    const invalidate = () => session.cancel();
    iframes.forEach((iframe) => iframe.addEventListener('load', invalidate));
    return () => { iframes.forEach((iframe) => iframe.removeEventListener('load', invalidate)); session.cancel(); };
  }, [session, options.scopeKey, options.getPreviewIframe, options.getPreviewIframes]);
  return { state, session };
}
