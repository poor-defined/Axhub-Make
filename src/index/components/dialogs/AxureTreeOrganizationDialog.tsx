import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AXURE_ORGANIZATION_LIMITS, type AxureTreeNode, type AxureTreePayload } from '../../../common/axureTreeOrganization';
import type { AxureOrganizationState } from '../../domains/export/axureOrganizationSession';

interface Props {
  state: AxureOrganizationState;
  onCancel: () => void;
  onRetry: () => void;
  onOrganize: (instruction: string) => void;
  onCopy: (version: 'original' | 'organized') => void;
}

function TreePreview({ payload, label }: { payload?: AxureTreePayload; label: string }) {
  let remaining = 2000;
  function renderNodes(nodes: AxureTreeNode[], depth = 0): React.ReactNode {
    if (depth > 24) return null;
    return <ul className="space-y-1 border-l pl-3">{nodes.map((node) => {
      if (--remaining < 0) return null;
      const children = node.scene?.items || node.maskedScene?.items || [];
      return <li key={node.id} className="text-sm leading-6">
        {children.length ? <details open={depth < 2}>
          <summary className="cursor-pointer break-words font-medium">
            {node.name || '未命名'} <span className="text-xs font-normal text-muted-foreground">({children.length})</span>
          </summary>
          {renderNodes(children, depth + 1)}
        </details> : <span className="block break-words">{node.name || '未命名'}</span>}
      </li>;
    })}</ul>;
  }
  return <section className="flex min-h-0 flex-col rounded-md border" aria-label={label}>
    <h3 className="border-b px-4 py-3 text-sm font-medium">{label}</h3>
    <div className="min-h-[120px] flex-1 overflow-auto p-4">
      {payload?.scene?.items ? renderNodes(payload.scene.items) : <p className="text-sm text-muted-foreground">整理后将在这里显示组件树</p>}
    </div>
  </section>;
}

export default function AxureTreeOrganizationDialog({ state, onCancel, onRetry, onOrganize, onCopy }: Props) {
  const analyzing = state.phase === 'analyzing';
  const copying = state.phase === 'copying';
  const [draft, setDraft] = React.useState('');
  const submittedDraft = React.useRef('');
  const inputId = React.useId();
  React.useEffect(() => { submittedDraft.current = ''; setDraft(''); }, [state.original]);
  React.useEffect(() => { if (state.version) setDraft((value) => value === submittedDraft.current ? '' : value); }, [state.version]);
  const turns = state.turns || [];
  const lastTurn = turns[turns.length - 1];
  const retryingDraft = lastTurn?.status === 'error'
    && lastTurn.instruction === (draft.trim() || '按业务含义整理组件树');
  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (analyzing || copying || !state.original || draft.length > AXURE_ORGANIZATION_LIMITS.instructionChars) return;
    submittedDraft.current = draft;
    if (retryingDraft) onRetry(); else onOrganize(draft.trim());
  };
  return <Dialog open={state.phase !== 'idle'} onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogContent className="flex max-h-[90vh] max-w-[1000px] flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>整理 Axure 组件树</DialogTitle>
        <DialogDescription>直接复制原始结构，或手动让 AI 按要求命名和分组。画面与元素内容保持不变。</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-6 items-center gap-2 text-sm" role="status" aria-live="polite">
        {(analyzing || copying) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {analyzing ? '正在根据页面文字、位置与层级整理…'
          : copying ? '正在复制到 Axure…'
            : state.phase === 'captured' ? '已获取原始结构。可直接复制，或点击下方按钮进行 AI 整理。'
            : state.plan ? `第 ${state.version || 1} 版已校验：${state.plan.renames.length} 个重命名，${state.plan.groups.length} 个分组`
              : '整理未完成，你仍可复制原始结构。'}
      </div>
      {state.error && <p role="alert" className="rounded-md border p-3 text-sm">{state.error}{state.organized && <span className="block text-muted-foreground">上一版有效结构已保留，仍可复制。</span>}</p>}
      <div className="grid max-h-[36vh] min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto md:grid-cols-2">
        <TreePreview payload={state.original} label="原始结构" />
        <TreePreview payload={state.organized} label="整理后结构" />
      </div>
      <section aria-label="AI 整理对话" className="min-h-0 shrink overflow-y-auto rounded-md border p-3">
        {turns.length > 0 && <ol className="mb-3 max-h-28 space-y-2 overflow-y-auto text-sm" aria-label="整理记录">
          {turns.map((turn, index) => <li key={index} className="border-l-2 pl-3">
            <p className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">你：</span>{turn.instruction}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">AI：{turn.status === 'pending' ? '正在整理…' : turn.summary || (turn.status === 'error' ? '本次整理未完成' : '整理完成')}</p>
          </li>)}
        </ol>}
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">整理要求</label>
          <Textarea id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={2}
            className="min-h-[64px] resize-y" disabled={analyzing || copying}
            maxLength={AXURE_ORGANIZATION_LIMITS.instructionChars}
            placeholder="例如：按业务模块分组；按钮使用 btn_ 前缀，分组使用中文命名。可继续补充或修改上一轮要求。"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) submit(event);
            }} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">首次可留空，按业务含义整理。每条最多 {AXURE_ORGANIZATION_LIMITS.instructionChars} 字。</p>
            <div className="flex gap-2">
              {lastTurn?.status === 'error' && !retryingDraft && <Button type="button" variant="ghost" disabled={analyzing || copying} onClick={onRetry}>重试本次整理</Button>}
              <Button type="submit" variant="outline" disabled={analyzing || copying || !state.original || draft.length > AXURE_ORGANIZATION_LIMITS.instructionChars}>
                {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                {analyzing ? '正在整理' : retryingDraft ? '重试本次整理' : !state.version ? 'AI 整理组件树' : draft.trim() ? '按要求继续整理' : '重新 AI 整理'}
              </Button>
            </div>
          </div>
        </form>
      </section>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button variant="ghost" onClick={onCancel}>{copying ? '关闭' : '取消'}</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={copying || !state.original} onClick={() => onCopy('original')}>复制原始结构</Button>
          <Button disabled={analyzing || copying || !state.organized} onClick={() => onCopy('organized')}>复制整理后的结构</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
