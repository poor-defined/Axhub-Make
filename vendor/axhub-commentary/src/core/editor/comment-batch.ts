import type { CommentaryComponentStatesRequest, CommentaryDocumentComponentCapture } from '../../web-editor-types';
import type { EditorElementScreenshot } from './screenshot';
import { COMMENT_PURPOSES } from './component-comments';
import { mergePromptCardSkills, type PromptCardSkillOption } from '../../ui/runtime/prompt-card-skills';

export type CommentBatchAction = 'send' | 'generate' | 'document';
export interface CommentListLoadState { status: 'loading' | 'ready' | 'error'; error?: string; revision?: number }
export interface CommentListEntry {
  id: string;
  label: string;
  note: string;
  purpose?: string;
  commentId?: string;
  elementKey?: string;
  locator?: import('../../web-editor-types').ElementLocator;
  state?: import('../../web-editor-types').PrototypeEditCommentStatus;
  skillIds?: string[];
  images?: import('./state').PromptImageAttachment[];
  selector?: string;
  element: Element | null;
  locatable?: boolean;
  disabledReason?: string;
}

export function buildCommentEntryInstructions(entry: CommentListEntry, skillOptions: readonly PromptCardSkillOption[] = []): string {
  const skills = mergePromptCardSkills(skillOptions);
  return [entry.note, ...(entry.skillIds || []).map(id => skills.find(skill => skill.id === id)?.prompt || `请参考技能：${id}`),
    ...(entry.images || []).filter(image => image.source !== 'target-screenshot').map(image => `参考附件：${image.name}（见截图中的同名参考图）`),
  ].filter(Boolean).join('\n\n');
}

export function buildCommentBatchPrompt(entries: readonly CommentListEntry[], options: { skillOptions?: readonly PromptCardSkillOption[]; transformPrompt?: (prompt: string) => string } = {}): string {
  const prompt = entries.map((entry, index) => [
    `## 批注 ${index + 1}：修改原型`, `批注 ID：${entry.id}`, `组件：${entry.label}`, `定位：${JSON.stringify(entry.locator)}`,
    buildCommentEntryInstructions(entry, options.skillOptions),
    ...(entry.images || []).filter(image => image.source !== 'target-screenshot').map(image => `附件 ${image.name}：${image.assetPath || image.data}`),
    `组件 HTML：\n${entry.element?.outerHTML || ''}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  return options.transformPrompt?.(prompt) ?? prompt;
}

/** Use explicit persisted identities, independent of the current canvas selection. */
export function createCommentBatchAction(options: {
  getEntries: () => readonly CommentListEntry[];
  skillOptions?: readonly PromptCardSkillOption[];
  getScopeRevision?: () => number | string;
  send?: (elements: Element[]) => Promise<void>;
  sendEntries?: (entries: readonly CommentListEntry[]) => Promise<void>;
  document?: (capture: CommentaryDocumentComponentCapture) => Promise<boolean>;
  generate?: (request: CommentaryComponentStatesRequest) => Promise<boolean>;
  capture: (element: Element, name: string) => Promise<EditorElementScreenshot>;
  compose?: typeof composeCommentScreenshots;
  getSource: () => { title: string; url: string };
}) {
  let busy = false;
  return async (action: CommentBatchAction, ids: readonly string[]): Promise<void> => {
    if (busy) throw new Error('正在处理批注，请稍候');
    const revision = options.getScopeRevision?.();
    const assertCurrentScope = () => {
      if (revision !== options.getScopeRevision?.()) throw new Error('页面已切换，请重新选择批注');
    };
    const selectedIds = Array.from(new Set(ids));
    if (!selectedIds.length) throw new Error('请选择至少一条批注');
    const available = new Map(options.getEntries().map(entry => [entry.id, entry]));
    const entries = selectedIds.map(id => {
      const entry = available.get(id);
      if (!entry?.element?.isConnected) throw new Error('所选批注的组件已失效，请重新选择');
      if (entry.disabledReason) throw new Error(entry.disabledReason);
      const expectedPurpose = COMMENT_PURPOSES.find(item => item.action === action)!.id;
      if ((entry.purpose !== undefined || !options.send) && entry.purpose !== expectedPurpose) throw new Error('所选批注用途不一致，请按用途发送；旧格式批注请重新创建');
      return { ...entry, skillIds: entry.skillIds?.slice(), images: entry.images?.map(image => ({ ...image })), element: entry.element };
    });
    busy = true;
    try {
      if (action === 'send') {
        if (options.sendEntries) { assertCurrentScope(); await options.sendEntries(entries); return; }
        if (!options.send) throw new Error('当前页面不支持发送修改');
        await options.send(entries.map(entry => entry.element));
        return;
      }
      if (action === 'document' && !options.document) throw new Error('当前页面不支持引入说明');
      if (action === 'generate' && !options.generate) throw new Error('当前页面不支持生成原型');
      const note = entries.map((entry, index) => `${index + 1}. ${entry.label}${entry.selector ? ` (${entry.selector})` : ''}\n${buildCommentEntryInstructions(entry, options.skillOptions)}`).join('\n\n');
      if (note.length > 8000) throw new Error('所选批注内容过长，请减少选择后重试');
      const sourceHtml = entries.map(entry => entry.element.outerHTML).join('\n');
      if (action === 'generate' && sourceHtml.length > 60000) throw new Error('所选组件内容过长，请减少选择后重试');
      const screenshots: Array<{ label: string; screenshot: EditorElementScreenshot }> = [];
      for (const entry of entries) {
        assertCurrentScope();
        if (!entry.element.isConnected) throw new Error('所选批注的组件已失效，请重新选择');
        screenshots.push({ label: entry.label, screenshot: await options.capture(entry.element, 'component') });
        for (const image of entry.images || []) {
          if (image.source === 'target-screenshot') continue;
          const data = image.data || image.assetPath;
          if (!data) throw new Error(`参考附件 ${image.name} 未能读取，请重新添加`);
          screenshots.push({ label: `${entry.label} · 参考附件 ${image.name}`, screenshot: { data, name: image.name, width: 1, height: 1 } });
        }
      }
      if (entries.some(entry => !entry.element.isConnected)) throw new Error('所选批注的组件已失效，请重新选择');
      assertCurrentScope();
      const imageDataUrl = screenshots.length === 1 ? screenshots[0].screenshot.data
        : await (options.compose ?? composeCommentScreenshots)(screenshots);
      assertCurrentScope();
      const source = options.getSource();
      const capture: CommentaryDocumentComponentCapture = {
        imageDataUrl, note,
        component: { name: entries.length === 1 ? entries[0].label.slice(0, 160) : `所选 ${entries.length} 个组件`,
          text: entries.map((entry, index) => `${index + 1}. ${entry.label}\n${entry.element.textContent || ''}`).join('\n\n').slice(0, 20000),
          ...(entries.length === 1 ? { selector: entries[0].selector } : {}),
        },
        source: { ...source, title: source.title.trim() || '当前页面' },
      };
      const handled = action === 'document' ? await options.document!(capture)
        : await options.generate!({ capture, title: `${capture.component.name} 状态说明`, layout: 'overview', sourceHtml });
      if (!handled) throw new Error('未能打开批注操作，请先处理当前任务后重试');
    } finally { busy = false; }
  };
}

/** Numbered real screenshots share one PNG so existing confirmation flows receive every component. */
export async function composeCommentScreenshots(items: readonly { label: string; screenshot: EditorElementScreenshot }[]): Promise<string> {
  const images = await Promise.all(items.map(item => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('组件截图读取失败，请重试'));
    image.src = item.screenshot.data;
  })));
  const width = Math.min(1440, Math.max(320, ...images.map(image => image.naturalWidth + 48)));
  const heights = images.map(image => image.naturalHeight * Math.min(1, (width - 48) / image.naturalWidth));
  const height = heights.reduce((total, value) => total + value + 72, 24);
  const scale = Math.min(1, 8192 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('组件截图合并失败，请重试');
  context.scale(scale, scale);
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#18181b'; context.font = '16px sans-serif';
  let y = 24;
  images.forEach((image, index) => {
    context.fillText(`${index + 1}. ${items[index].label.slice(0, 100)}`, 24, y + 20, width - 48);
    y += 40;
    const imageScale = Math.min(1, (width - 48) / image.naturalWidth);
    context.drawImage(image, 24, y, image.naturalWidth * imageScale, heights[index]);
    y += heights[index] + 32;
  });
  const result = canvas.toDataURL('image/png');
  if (result.length > Math.ceil(8 * 1024 * 1024 * 4 / 3) + 100) throw new Error('组件截图总大小过大，请减少选择后重试');
  return result;
}
