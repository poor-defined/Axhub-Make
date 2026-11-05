import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AxureTreeNode, AxureTreePayload } from '../../../common/axureTreeOrganization';
import type { AxureOrganizationState } from '../../domains/export/axureOrganizationSession';

interface Props {
  state: AxureOrganizationState;
  onCancel: () => void;
  onRetry: () => void;
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
    <div className="min-h-[240px] flex-1 overflow-auto p-4">
      {payload?.scene?.items ? renderNodes(payload.scene.items) : <p className="text-sm text-muted-foreground">整理后将在这里显示组件树</p>}
    </div>
  </section>;
}

export default function AxureTreeOrganizationDialog({ state, onCancel, onRetry, onCopy }: Props) {
  const analyzing = state.phase === 'analyzing';
  const copying = state.phase === 'copying';
  return <Dialog open={state.phase !== 'idle'} onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogContent className="max-h-[90vh] max-w-[1000px] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>整理 Axure 组件树</DialogTitle>
        <DialogDescription>按业务含义命名和分组，确认后复制到 Axure。画面与元素内容保持不变。</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-6 items-center gap-2 text-sm" role="status" aria-live="polite">
        {(analyzing || copying) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {analyzing ? '正在根据页面文字、位置与层级整理…'
          : copying ? '正在复制到 Axure…'
            : state.phase === 'captured' ? '已获取当前原型，可先进行 AI 整理，或直接复制原始结构。'
            : state.plan ? `已校验：${state.plan.renames.length} 个重命名，${state.plan.groups.length} 个分组`
              : '整理未完成，你仍可复制原始结构。'}
      </div>
      {state.error && <p role="alert" className="rounded-md border p-3 text-sm">{state.error}</p>}
      <div className="grid max-h-[55vh] min-h-0 grid-cols-1 gap-4 overflow-auto md:grid-cols-2">
        <TreePreview payload={state.original} label="原始结构" />
        <TreePreview payload={state.organized} label="整理后结构" />
      </div>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button variant="ghost" onClick={onCancel}>{copying ? '关闭' : '取消'}</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={analyzing || copying || !state.original} onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" />{state.phase === 'captured' ? 'AI 整理组件树' : '重试 AI 整理'}
          </Button>
          <Button variant="outline" disabled={copying || !state.original} onClick={() => onCopy('original')}>复制原始结构</Button>
          <Button disabled={analyzing || copying || !state.organized} onClick={() => onCopy('organized')}>复制整理后的结构</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
