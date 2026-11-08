import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { DocumentationState } from '../../domains/documentation/documentationSession';
interface Props {
  state: DocumentationState;
  documents: Array<{ path: string; title: string }>;
  documentsError?: string;
  onSelectDocument: (path: string) => void;
  onEdit: (value: { title?: string; description?: string }) => void;
  onGenerate: (instruction: string) => void;
  onAppend: () => void;
  onClose: () => void;
}
export default function ComponentDocumentationDialog({
  state,
  documents,
  documentsError,
  onSelectDocument,
  onEdit,
  onGenerate,
  onAppend,
  onClose,
}: Props) {
  const [instruction, setInstruction] = React.useState('');
  React.useEffect(() => setInstruction(''), [state.capture]);
  const busy = state.phase === 'generating' || state.phase === 'saving';
  const saved = state.phase === 'saved';
  return (
    <Dialog
      open={state.phase !== 'idle'}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>引入组件说明</DialogTitle>
          <DialogDescription>
            将组件的真实截图和说明追加到当前项目的 PRD 末尾。生成后可编辑，确认后写入。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          <label className="block space-y-2 text-sm font-medium">
            目标 PRD
            <select
              aria-label="目标 PRD"
              className="block h-10 w-full rounded-md border bg-background px-3 font-normal"
              value={state.documentPath}
              disabled={busy || saved}
              onChange={(event) => onSelectDocument(event.target.value)}
            >
              <option value="">请选择当前项目的 PRD</option>
              {documents.map((doc) => (
                <option key={doc.path} value={doc.path}>
                  {doc.title} · {doc.path}
                </option>
              ))}
            </select>
          </label>
          {documentsError ? (
            <p role="alert" className="text-sm text-destructive">
              {documentsError}
            </p>
          ) : !documents.length ? (
            <p className="text-sm text-muted-foreground">
              当前项目没有可编辑的 Markdown 文档。请先在“文档”中创建 PRD，再重新引入。
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="min-w-0 rounded-md border">
              <h3 className="border-b px-4 py-3 text-sm font-medium">
                {state.capture?.component.name || '组件截图'}
              </h3>
              <div className="max-h-[45vh] overflow-auto bg-muted/20 p-4">
                {state.capture && (
                  <img
                    src={state.capture.imageDataUrl}
                    alt={`${state.capture.component.name}的真实截图`}
                    className="h-auto max-w-full rounded border bg-white"
                  />
                )}
              </div>
              <p className="break-all px-4 py-3 text-xs text-muted-foreground">
                来源：{state.capture?.source.title}
                <br />
                {state.capture?.source.url}
              </p>
            </section>
            <section className="flex min-w-0 flex-col gap-3 rounded-md border p-4">
              <label className="space-y-2 text-sm font-medium">
                组件标题
                <input
                  aria-label="组件标题"
                  value={state.title}
                  disabled={busy || saved}
                  maxLength={120}
                  className="block h-9 w-full rounded border bg-background px-3 font-normal"
                  placeholder="AI 生成后可编辑"
                  onChange={(event) => onEdit({ title: event.target.value })}
                />
              </label>
              <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
                图文说明（Markdown）
                <textarea
                  aria-label="图文说明"
                  className="min-h-[220px] w-full flex-1 resize-y rounded border bg-background p-3 text-sm font-normal leading-6"
                  value={state.description}
                  disabled={busy || saved}
                  maxLength={30000}
                  placeholder="点击下方按钮生成。业务信息不足时，AI 会标记为“待确认”。"
                  onChange={(event) => onEdit({ description: event.target.value })}
                />
              </label>
            </section>
          </div>
          {state.capture?.note && (
            <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">组件批注：</span>
              {state.capture.note}
            </p>
          )}
          {state.description && (
            <label className="block space-y-2 text-sm font-medium">
              重新生成要求（可选）
              <textarea
                aria-label="补充生成要求"
                rows={2}
                maxLength={4000}
                disabled={busy || saved}
                className="block w-full rounded border bg-background p-3 font-normal"
                placeholder="例如：按组件用途、操作说明和待确认事项组织内容"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
          )}
          {(state.error || saved) && (
            <p
              role={saved ? 'status' : 'alert'}
              className={`text-sm ${saved ? 'text-emerald-700' : 'text-destructive'}`}
            >
              {saved ? '已将截图和说明追加到 PRD 末尾。' : state.error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose} disabled={state.phase === 'saving'}>
            {saved ? '完成' : state.phase === 'generating' ? '取消生成' : '取消'}
          </Button>
          {!saved && (
            <>
              <Button
                variant="outline"
                disabled={busy || !state.documentPath}
                onClick={() => onGenerate(instruction)}
              >
                {state.phase === 'generating'
                  ? 'AI 正在生成…'
                  : state.description
                    ? '重新生成图文'
                    : 'AI 生成图文'}
              </Button>
              <Button
                disabled={
                  state.phase !== 'ready' ||
                  !state.documentPath ||
                  !state.title.trim() ||
                  !state.description.trim()
                }
                onClick={onAppend}
              >
                {state.phase === 'saving' ? '正在追加…' : '确认追加到 PRD 末尾'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
