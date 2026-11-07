import React from 'react';
import { Plus, FileCode2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  referenceRequest,
  type ReferencePage,
} from '../../domains/documentation/referencePagesClient';
interface Props {
  projectId: string;
  pages: ReferencePage[];
  selectedId?: string;
  loading: boolean;
  error?: string;
  onSelect: (page: ReferencePage) => void;
  onImported: (page: ReferencePage) => void;
  onRefresh: () => void;
}
export default function ReferencePagesPanel({
  projectId,
  pages,
  selectedId,
  loading,
  error,
  onSelect,
  onImported,
  onRefresh,
}: Props) {
  const [open, setOpen] = React.useState(false),
    [url, setUrl] = React.useState(''),
    [title, setTitle] = React.useState(''),
    [entryPath, setEntryPath] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null),
    [busy, setBusy] = React.useState(false),
    [importError, setImportError] = React.useState('');
  const controller = React.useRef<AbortController>();
  React.useEffect(() => {
    setBusy(false);
    setOpen(false);
    return () => controller.current?.abort();
  }, [projectId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || busy || (!file && !url.trim())) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setImportError('');
    const form = new FormData();
    if (file) form.set('file', file);
    else form.set('url', url.trim());
    if (title.trim()) form.set('title', title.trim());
    if (entryPath.trim()) form.set('entryPath', entryPath.trim());
    try {
      const body = await referenceRequest<{ page: ReferencePage }>(
        `/api/reference-pages?projectId=${encodeURIComponent(projectId)}`,
        { method: 'POST', body: form, signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      onImported(body.page);
      setOpen(false);
      setUrl('');
      setFile(null);
      setTitle('');
      setEntryPath('');
    } catch (error) {
      if (!abort.signal.aborted)
        setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">项目参考页</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!projectId}
          onClick={() => {
            setImportError('');
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          导入
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : error ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          {error}
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            重试
          </Button>
        </div>
      ) : !pages.length ? (
        <p className="py-4 text-xs leading-6 text-muted-foreground">
          导入 Axure 发布的链接、ZIP 或 HTML，即可选中组件并将截图与说明引入
          PRD。链接默认只缓存当前页面。
        </p>
      ) : (
        pages.map((page) => (
          <button
            key={page.id}
            className={`flex w-full items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-muted ${selectedId === page.id ? 'bg-accent font-medium' : ''}`}
            onClick={() => onSelect(page)}
          >
            <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">
              {page.title}
              <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                {page.htmlFiles.length} 个页面
              </span>
            </span>
          </button>
        ))
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入参考页</DialogTitle>
            <DialogDescription>
              链接缓存当前页面及所需资源。完整 Axure 发布目录请压缩为 ZIP；单个 HTML
              应自带所需资源。
            </DialogDescription>
          </DialogHeader>
          <form id="reference-import" onSubmit={submit} className="space-y-4">
            <label className="block space-y-2 text-sm">
              页面链接
              <input
                type="url"
                aria-label="页面链接"
                placeholder="https://…"
                value={url}
                disabled={busy || Boolean(file)}
                onChange={(event) => setUrl(event.target.value)}
                className="block h-10 w-full rounded border bg-background px-3"
              />
            </label>
            <label className="block space-y-2 text-sm">
              或上传 ZIP / HTML
              <input
                aria-label="上传参考页"
                type="file"
                accept=".zip,.html,.htm"
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="block w-full text-sm"
              />
            </label>
            {file && (
              <Button variant="ghost" size="sm" type="button" onClick={() => setFile(null)}>
                改用链接导入
              </Button>
            )}
            <label className="block space-y-2 text-sm">
              显示名称（可选）
              <input
                value={title}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                className="block h-10 w-full rounded border bg-background px-3"
              />
            </label>
            <label className="block space-y-2 text-sm">
              ZIP 入口路径（可选）
              <input
                value={entryPath}
                disabled={busy}
                placeholder="例如：发布目录/index.html；留空自动识别"
                onChange={(event) => setEntryPath(event.target.value)}
                className="block h-10 w-full rounded border bg-background px-3"
              />
            </label>
            {importError && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="reference-import" disabled={busy || (!file && !url.trim())}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在缓存…
                </>
              ) : (
                '导入当前页面'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
