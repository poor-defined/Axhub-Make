import { PageSkeleton } from '@/components/ui/page-skeleton';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { PrdImageRenamePreview } from '../../../common/prdImageRename';
interface Props { open: boolean; projectId: string; onDone: (changed?: boolean) => void; }
export default function PrdImageRenameDialog({ open, projectId, onDone }: Props) {
  const [plan, setPlan] = React.useState<PrdImageRenamePreview | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [backup, setBackup] = React.useState('');
  const controller = React.useRef<AbortController>();
  const scan = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setPlan(null);
    try {
      const response = await fetch(`/api/prd-images/preview?projectId=${encodeURIComponent(projectId)}`, { signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '扫描失败');
      if (!abort.signal.aborted) setPlan(body);
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  React.useEffect(() => {
    setBackup(''); setPlan(null); setError('');
    if (open) void scan();
    return () => controller.current?.abort();
  }, [open, projectId]);
  const apply = async () => {
    if (!plan || busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/prd-images/apply?projectId=${encodeURIComponent(projectId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digest: plan.digest }), signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '批量修改失败');
      if (!abort.signal.aborted) setBackup(body.backupDirectory);
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onDone(Boolean(backup)); }}>
    <DialogContent className="z-[220] max-h-[85vh] max-w-[800px] overflow-y-auto" overlayClassName="z-[219]"
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>是否批量规范 PRD 图片名称？</DialogTitle>
        <DialogDescription>PRD 路径已保存。确认后按模板中的功能编号重命名图片附件，并更新文档中的图片引用和说明。取消仅保留路径配置。</DialogDescription>
      </DialogHeader>
      {busy && plan && <p role="status" className="text-sm text-muted-foreground">正在处理，请稍候…</p>}
      {busy && !plan && !backup ? <PageSkeleton variant="table" label="正在读取 PRD 图片引用" /> : null}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {backup ? <div role="status" className="space-y-2 text-sm"><p>已完成批量修改，原文件已备份。</p><p className="break-all select-text">备份位置：{backup}</p></div> : plan && <div className="space-y-3">
        <p className="text-sm">扫描 {plan.documentCount} 份 PRD，建议整理 {plan.items.length} 个图片附件。</p>
        <p className="text-xs leading-5 text-muted-foreground">执行前备份原文档及附件；目标名称已存在时不会覆盖。只更新当前配置范围内的 PRD，其他文档对这些附件的引用不会自动更新。</p>
        {plan.backupParentDirectory && <p className="break-all text-xs text-muted-foreground">备份目录：{plan.backupParentDirectory}</p>}
        {plan.warnings.map(warning => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}
        <div className="max-h-[40vh] overflow-auto rounded-md border">
          <table className="w-full text-left text-xs"><thead><tr className="border-b bg-muted/40"><th className="p-2">原名称</th><th className="p-2">建议名称</th><th className="p-2">引用说明</th></tr></thead><tbody>
            {plan.items.map((item, index) => <tr key={index} className="border-b last:border-0"><td className="break-all p-2" title={item.documentPath}>{item.from}</td><td className="break-all p-2">{item.to}</td><td className="p-2">{item.label}</td></tr>)}
          </tbody></table>
        </div>
        {!plan.items.length && <p className="text-sm text-muted-foreground">当前图片名称和引用已符合规范，无需修改。</p>}
      </div>}
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => onDone(Boolean(backup))}>{backup || plan?.items.length === 0 ? '完成' : '暂不修改'}</Button>
        {!backup && <Button variant="outline" disabled={busy} onClick={() => void scan()}>重新扫描</Button>}
        {!backup && <Button disabled={busy || !plan?.items.length} onClick={() => void apply()}>确认批量修改</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
