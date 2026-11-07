import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ComponentDocumentationCapture } from '../../../common/componentDocumentation';
import {
  referenceDocumentPath,
  referencePreviewUrl,
  type ReferencePage,
} from '../../domains/documentation/referencePagesClient';
interface Props {
  projectId: string;
  page: ReferencePage | null;
  onDocumentComponent: (capture: ComponentDocumentationCapture) => void;
  onGeneratePrototype: (prompt: string, targetPath: string) => Promise<boolean>;
}
interface PendingGeneration {
  prompt: string;
  targetPath: string;
  scope: string;
  pageTitle: string;
  entry: string;
}
export default function ReferencePageView({
  projectId,
  page,
  onDocumentComponent,
  onGeneratePrototype,
}: Props) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const startupTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = React.useRef<PendingGeneration | null>(null);
  const openingRef = React.useRef(false);
  const [pending, setPending] = React.useState<PendingGeneration | null>(null);
  const [opening, setOpening] = React.useState(false);
  const [generationError, setGenerationError] = React.useState('');
  React.useEffect(() => () => clearTimeout(startupTimer.current), []);
  const [entry, setEntry] = React.useState(page?.entryPath || ''),
    [ready, setReady] = React.useState(false),
    [error, setError] = React.useState(''),
    [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    setEntry(page?.entryPath || '');
    setReady(false);
    setError('');
  }, [page?.id, projectId]);
  const target = page ? referenceDocumentPath(page, entry) : '';
  const scope = `${projectId}:${page?.id || ''}:${entry}`;
  const currentScope = React.useRef(scope);
  currentScope.current = scope;
  const closeGeneration = React.useCallback(() => {
    if (openingRef.current) return;
    pendingRef.current = null;
    setPending(null);
    setGenerationError('');
  }, []);
  React.useEffect(() => {
    pendingRef.current = null;
    openingRef.current = false;
    setPending(null);
    setOpening(false);
    setGenerationError('');
  }, [scope]);
  const confirmGeneration = async () => {
    if (
      !pending ||
      openingRef.current ||
      pending !== pendingRef.current ||
      pending.scope !== currentScope.current
    )
      return;
    openingRef.current = true;
    setOpening(true);
    setGenerationError('');
    try {
      const handled = await onGeneratePrototype(pending.prompt, pending.targetPath);
      if (pending.scope !== currentScope.current) return;
      if (handled) {
        pendingRef.current = null;
        setPending(null);
      } else setGenerationError('未能交给 AI，请检查 AI 服务后重试。');
    } catch (error) {
      if (pending.scope === currentScope.current)
        setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      if (pending.scope === currentScope.current) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  };
  const enable = React.useCallback(() => {
    setReady(false);
    setError('');
    if (!page) return;
    clearTimeout(startupTimer.current);
    startupTimer.current = setTimeout(
      () => setError('批注工具未能加载。请刷新页面；如果使用 ZIP，可在上方选择具体内容页。'),
      15000,
    );
    frame.current?.contentWindow?.postMessage(
      {
        type: 'AXHUB_PROTOTYPE_EDITOR_ENABLE',
        requestId: 'reference-enable',
        context: {
          projectId,
          documentPath: target,
          resourceId: target,
          displayName: page.title,
          makeServerOrigin: window.location.origin,
          referenceSandbox: true,
        },
        options: { makeServerOrigin: window.location.origin, toolbarMode: 'inline' },
      },
      '*',
    );
  }, [page, projectId, target]);
  React.useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const data = event.data;
      if (data?.type === 'AXHUB_REFERENCE_PAGE_READY' && page && typeof data.url === 'string') {
        try {
          const url = new URL(data.url);
          const prefix = `/api/projects/${encodeURIComponent(projectId)}/reference-pages/${encodeURIComponent(page.id)}/files/`;
          if (url.origin !== window.location.origin || !url.pathname.startsWith(prefix)) return;
          const nextEntry = decodeURIComponent(url.pathname.slice(prefix.length));
          if (page.htmlFiles.includes(nextEntry) && nextEntry !== entry) setEntry(nextEntry);
        } catch {
          /* Ignore navigation outside this imported reference. */
        }
        return;
      }
      if (data?.type === 'AXHUB_REFERENCE_COMMENTS_REQUEST' && page) {
        const source = frame.current?.contentWindow;
        const response = (body: Record<string, unknown>) =>
          source?.postMessage(
            { type: 'AXHUB_REFERENCE_COMMENTS_RESULT', requestId: data.requestId, ...body },
            '*',
          );
        if (!['read', 'write'].includes(data.operation) || typeof data.requestId !== 'string') {
          response({ success: false, error: '无效的参考页批注请求' });
          return;
        }
        const params = new URLSearchParams({
          projectId,
          path: target,
          ...(data.operation === 'read' ? { hydrateImages: '1' } : {}),
        });
        const body = {
          document: data.document,
          reason: data.reason,
          observedTombstones: data.observedTombstones,
        };
        if (data.operation === 'write' && JSON.stringify(body).length > 2_000_000) {
          response({ success: false, error: '参考页批注超过大小限制' });
          return;
        }
        void fetch(
          `/api/document-comments?${params}`,
          data.operation === 'read'
            ? {}
            : {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              },
        )
          .then(async (result) => {
            const payload = await result.json();
            if (!result.ok) throw new Error(payload.error || '参考页批注保存失败');
            response({ success: true, document: payload.exists ? payload.document : null });
          })
          .catch((error) =>
            response({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return;
      }
      if (data?.type === 'AXHUB_PROTOTYPE_EDITOR_STATE' && data.requestId === 'reference-enable') {
        clearTimeout(startupTimer.current);
        setReady(data.success === true);
        if (data.error) setError(String(data.error));
        return;
      }
      if (data?.type !== 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_REQUEST' || !page) return;
      const respond = (handled: boolean, error?: string) =>
        frame.current?.contentWindow?.postMessage(
          {
            type: 'AXHUB_PROTOTYPE_EDITOR_HOST_TOOLBAR_ACTION_RESULT',
            requestId: data.requestId,
            handled,
            ...(error ? { error } : {}),
          },
          '*',
        );
      if (data.action?.type === 'wake-agent') {
        respond(true);
        return;
      }
      if (data.action?.type === 'document-component') {
        onDocumentComponent({
          ...data.action.payload,
          source: {
            title: `${page.title}（${entry}）`,
            url:
              page.sourceUrl ||
              new URL(referencePreviewUrl(page, entry), window.location.origin).href,
          },
        });
        respond(true);
        return;
      }
      if (data.action?.type === 'send-to-agent') {
        const prompt = data.action.promptText;
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 60000) {
          respond(false, '请先输入组件批注，且不超过 60000 字符');
          return;
        }
        if (pendingRef.current || openingRef.current) {
          respond(false, '请先处理已打开的 AI 生成确认');
          return;
        }
        // Imported scripts can forge iframe messages. Only a parent-owned user
        // confirmation may forward this untrusted prompt to an executable AI flow.
        const request = { prompt, targetPath: target, scope, pageTitle: page.title, entry };
        pendingRef.current = request;
        setPending(request);
        setGenerationError('');
        respond(true);
        return;
      }
      respond(false, '参考页面暂不支持此操作');
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [page, entry, target, scope, projectId, onDocumentComponent]);
  const annotate = () =>
    frame.current?.contentWindow?.postMessage({ type: 'AXHUB_REFERENCE_SELECT_COMPONENT' }, '*');
  if (!page)
    return (
      <main className="flex flex-1 items-center justify-center bg-muted/10 p-10">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">参考页面</h1>
          <p className="text-sm leading-7 text-muted-foreground">
            从左侧导入 Axure 发布页面，再选中一个组件，填写批注并选择“引入说明”，生成可追加到 PRD
            的图文。
          </p>
        </div>
      </main>
    );
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h1 className="mr-auto truncate text-sm font-medium">{page.title}</h1>
        {page.sourceUrl && (
          <Button size="sm" variant="ghost" asChild>
            <a href={page.sourceUrl} target="_blank" rel="noopener noreferrer">
              打开来源
            </a>
          </Button>
        )}
        {page.htmlFiles.length > 1 && (
          <select
            aria-label="参考页面"
            className="max-w-[260px] rounded border bg-background p-1 text-xs"
            value={entry}
            onChange={(event) => {
              setEntry(event.target.value);
              setReady(false);
            }}
          >
            {page.htmlFiles.map((path) => (
              <option key={path}>{path}</option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setReady(false);
            setReload((value) => value + 1);
          }}
        >
          刷新页面
        </Button>
        <Button size="sm" disabled={!ready} onClick={() => void annotate()}>
          选择组件 / 批注
        </Button>
      </header>
      {page.warnings.length > 0 && (
        <details className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">导入提示（{page.warnings.length}）</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {page.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!ready && !error && (
        <p className="px-4 py-2 text-xs text-muted-foreground">正在加载参考页批注工具…</p>
      )}
      <iframe
        ref={frame}
        key={`${projectId}:${page.id}:${entry}:${reload}`}
        title={page.title}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        src={referencePreviewUrl(page, entry)}
        sandbox="allow-scripts"
        onLoad={enable}
      />
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) closeGeneration();
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (opening) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (opening) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>AI 生成参考原型</DialogTitle>
            <DialogDescription>
              请确认参考页提交的要求。确认后，AI 将修改此参考页面，并使用线框图风格。
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm">
            {pending?.pageTitle} · {pending?.entry}
          </p>
          <textarea
            aria-label="即将交给 AI 的要求"
            readOnly
            value={pending?.prompt || ''}
            className="max-h-[50vh] min-h-[180px] w-full resize-y overflow-auto rounded-md border bg-muted/20 p-3 text-sm leading-6"
          />
          {generationError && (
            <p role="alert" className="text-sm text-destructive">
              {generationError}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={opening} onClick={closeGeneration}>
              取消
            </Button>
            <Button disabled={opening} onClick={() => void confirmGeneration()}>
              {opening ? '正在交给 AI…' : '确认交给 AI'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
