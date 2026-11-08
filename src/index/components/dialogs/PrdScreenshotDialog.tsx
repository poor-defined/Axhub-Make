import { PageSkeleton } from '@/components/ui/page-skeleton';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { PrdScreenshotPlan, PrdScreenshotJob } from '../../../common/prdScreenshots';
interface Props { projectId: string; documentId: string; onClose: (changed?: boolean) => void; }
export default function PrdScreenshotDialog({ projectId, documentId, onClose }: Props) {
  const [plan, setPlan] = React.useState<PrdScreenshotPlan | null>(null);
  const [job, setJob] = React.useState<PrdScreenshotJob | null>(null);
  const [pages, setPages] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(''), [error, setError] = React.useState('');
  const [done, setDone] = React.useState<{ updated: number; backupDirectory: string } | null>(null);
  const controller = React.useRef<AbortController>();
  const request = async <T,>(action: string, body?: unknown): Promise<T> => {
    const abort = new AbortController(); controller.current = abort;
    const query = new URLSearchParams({ projectId, ...(body === undefined ? { document: documentId } : {}) });
    const response = await fetch(`/api/prd-screenshots/${action}?${query}`, { signal: abort.signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '截图操作失败');
    if (abort.signal.aborted) throw new Error('任务已取消');
    return result;
  };
  const scan = async () => {
    controller.current?.abort(); setBusy('scan'); setError(''); setJob(null); setDone(null); setPlan(null); setPages({});
    try {
      const result = await request<PrdScreenshotPlan>('preview');
      setPlan(result); setPages(Object.fromEntries(result.items.map(item => [item.asset, !item.error && item.pages.length === 1 ? item.pages[0] : ''])));
    } catch (error) { if (!controller.current?.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.current?.signal.aborted) setBusy(''); }
  };
  React.useEffect(() => { void scan(); return () => controller.current?.abort(); }, [projectId, documentId]);
  const capture = async () => {
    if (!plan) return;
    setBusy('capture'); setError('');
    try {
      const result = await request<PrdScreenshotJob>('capture', { document: plan.document, digest: plan.digest, selections: Object.entries(pages).filter(([, page]) => page).map(([asset, page]) => ({ asset, page })) });
      setJob(result);
    } catch (error) { if (!controller.current?.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.current?.signal.aborted) setBusy(''); }
  };
  const apply = async () => {
    if (!job) return;
    setBusy('apply'); setError('');
    try { setDone(await request('apply', { jobId: job.jobId })); }
    catch (error) { if (!controller.current?.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.current?.signal.aborted) setBusy(''); }
  };
  const success = job?.items.filter(item => item.previewUrl).length || 0;
  const close = async () => {
    if (job && !done) {
      setBusy('discard');
      try { await request('discard', { jobId: job.jobId }); } catch { /* A failed cleanup never changes PRD attachments. */ }
    }
    onClose(Boolean(done));
  };
  return <Dialog open onOpenChange={value => { if (!value && !busy) void close(); }}>
    <DialogContent className="z-[220] max-h-[90vh] max-w-[1000px] overflow-y-auto" overlayClassName="z-[219]"
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>从本地参考发布更新截图</DialogTitle>
        <DialogDescription>附件名称对应 [prd:标识]，例如 cfd-f02-hero.png。先选择来源页面并生成预览，确认后才替换原图；Markdown 引用保持不变。</DialogDescription>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">截图尺寸条件：浏览器 1920 × 1080，按标记区域裁切；仅加载本地发布资源。隐藏状态、重复标记和缺失资源会跳过。</p>
      {busy === 'scan' ? <PageSkeleton variant="table" label="正在扫描本地发布与图片引用" /> : null}
      {busy && busy !== 'scan' && <p role="status" className="text-sm">{busy === 'capture' ? '正在独立浏览器中生成截图，请保持窗口打开…' : busy === 'apply' ? '正在备份并替换附件…' : busy === 'discard' ? '正在清理临时预览…' : '正在读取本地发布与图片引用…'}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {done ? <div role="status" className="space-y-2 text-sm"><p>已更新 {done.updated} 张截图，未改动文档文字和引用路径。</p><p className="break-all">原图备份：{done.backupDirectory}</p></div>
        : job ? <div className="space-y-3">
          <p className="text-sm">成功 {success} 项，失败 {job.items.length - success} 项。确认后只替换成功项，失败项保留原图。</p>
          <div className="grid max-h-[50vh] gap-3 overflow-auto md:grid-cols-2">{job.items.map(item => <section key={item.asset} className="space-y-2 rounded-md border p-3"><p className="break-all text-xs">{item.asset} · {item.page}</p>{item.previewUrl ? <a href={item.previewUrl} target="_blank" rel="noreferrer"><img src={item.previewUrl} alt={`待替换截图：${item.asset}`} className="max-h-64 w-full object-contain" /></a> : <p className="text-xs text-destructive">{item.error}</p>}</section>)}</div>
        </div> : plan && <div className="space-y-3">
          <p className="text-sm">找到 {plan.items.length} 个图片附件。多页面候选需手动选择；旧附件名可先在项目设置中“整理图片名称”。</p>
          <div className="max-h-[45vh] overflow-auto rounded-md border"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-muted/30"><th className="p-2">图片附件／标记</th><th className="p-2">发布页面</th></tr></thead><tbody>{plan.items.map(item => <tr key={item.asset} className="border-b last:border-0"><td className="break-all p-2">{item.asset}<span className="block text-muted-foreground">[prd:{item.marker}]</span></td><td className="p-2">{item.error ? <span className="text-destructive">{item.error}</span> : <select aria-label={`截图来源：${item.asset}`} className="max-w-full rounded border bg-background p-1" disabled={Boolean(busy)} value={pages[item.asset] || ''} onChange={event => setPages(old => ({ ...old, [item.asset]: event.target.value }))}><option value="">不更新／选择页面</option>{item.pages.map(page => <option key={page} value={page}>{page}</option>)}</select>}</td></tr>)}</tbody></table></div>
          {!plan.items.length && <p className="text-sm text-muted-foreground">PRD 中没有可更新的本地图片附件。</p>}
        </div>}
      <DialogFooter>
        <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void close()}>{done ? '完成' : '取消'}</Button>
        {!done && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void scan()}>重新扫描</Button>}
        {!done && !job && <Button disabled={Boolean(busy) || !plan || !Object.values(pages).some(Boolean)} onClick={() => void capture()}>生成截图预览</Button>}
        {!done && job && <Button disabled={Boolean(busy) || !success} onClick={() => void apply()}>确认替换成功截图</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
