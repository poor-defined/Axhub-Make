import { ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ComponentStatesState } from '../../domains/prototype-generation/componentStatesSession';
import type { ComponentStatesRequest } from '../../../common/componentStates';
interface Props {
  state: ComponentStatesState;
  onEdit: (patch: Partial<Pick<ComponentStatesRequest, 'title' | 'layout'>> & { note?: string }) => void;
  onGenerate: () => void;
  onClose: () => void;
  onOpenPrototype: () => void;
}
export default function ComponentStatesDialog({ state, onEdit, onGenerate, onClose, onOpenPrototype }: Props) {
  const request = state.request;
  if (!request) return null;
  const busy = state.phase === 'preparing' || state.phase === 'running';
  const locked = busy || Boolean(state.prepared);
  return <Dialog open={state.visible} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>生成组件状态原型</DialogTitle>
        <DialogDescription>以选中组件为起点，在独立页面中展示不同状态、触发条件与变化说明。</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="min-w-0 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />当前选中组件</div>
          <div className="flex min-h-36 items-center justify-center overflow-hidden rounded-lg border bg-muted/20 p-3"><img src={request.capture.imageDataUrl} alt={`来源组件：${request.capture.component.name}`} className="max-h-64 max-w-full object-contain" /></div>
          <div className="space-y-1 text-xs leading-5 text-muted-foreground"><p className="break-words font-medium text-foreground">{request.capture.component.name}</p><p className="break-words">来源：{request.capture.source.title}</p></div>
        </section>
        <section className="min-w-0 space-y-4">
          <label className="block space-y-2 text-sm font-medium">新原型名称<Input aria-label="新原型名称" value={request.title} maxLength={100} disabled={locked} onChange={event => onEdit({ title: event.target.value })} /></label>
          <label className="block space-y-2 text-sm font-medium">状态与变化要求<textarea aria-label="状态与变化要求" className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" value={request.capture.note} maxLength={8000} disabled={locked} placeholder="例如：未登录、已登录、语言菜单展开；说明触发方式和变化内容。" onChange={event => onEdit({ note: event.target.value })} /></label>
          <fieldset disabled={locked} className="space-y-2"><legend className="mb-2 text-sm font-medium">展示方式</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm"><input className="mt-1 accent-emerald-600" type="radio" name="component-states-layout" value="overview" checked={request.layout === 'overview'} onChange={() => onEdit({ layout: 'overview' })} /><span>同页平铺<span className="mt-0.5 block text-xs text-muted-foreground">逐一对照，便于选中各状态继续批注</span></span></label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm"><input className="mt-1 accent-emerald-600" type="radio" name="component-states-layout" value="interactive" checked={request.layout === 'interactive'} onChange={() => onEdit({ layout: 'interactive' })} /><span>交互切换<span className="mt-0.5 block text-xs text-muted-foreground">通过控件切换组件状态及对应说明</span></span></label>
          </fieldset>
        </section>
      </div>
      {busy || state.phase === 'done' ? <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm">{busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}<span>{state.message}</span></div> : null}
      {state.error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{state.error}{state.prepared ? <p className="mt-1 text-xs">目标原型已保留，重试会继续使用同一个页面。</p> : null}</div> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{busy ? '后台运行' : state.phase === 'done' ? '关闭' : '取消'}</Button>
        {state.phase === 'done' ? <Button onClick={onOpenPrototype}>打开新原型<ArrowUpRight className="ml-1 h-4 w-4" /></Button> : <Button disabled={busy || !request.title.trim() || !request.capture.note.trim()} onClick={onGenerate}>{busy ? '正在生成…' : state.phase === 'error' ? '重试生成' : '确认生成'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
