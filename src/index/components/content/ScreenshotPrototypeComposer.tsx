import { forwardRef, useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp, ImagePlus, Loader2, X } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, SCREENSHOT_MIME_TYPES, type ScreenshotPrototypeImage, validateScreenshotPrototypeRequest } from '@/common/screenshotPrototype';
import { getClipboardImageFiles } from '../../domains/shared/clipboardImages';
import type { ScreenshotPrototypeController } from '../../domains/prototype-generation/useScreenshotPrototype';

export function ScreenshotPrototypeStartCard({ inputRef }: { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  return <li className="flex">
    <button type="button" className="flex min-h-16 w-full items-center gap-3 rounded-[10px] border border-slate-200/80 bg-white/80 px-4 py-3 text-left text-[13px] font-medium text-slate-700 hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
      onClick={() => { inputRef.current?.scrollIntoView({ block: 'center' }); inputRef.current?.focus({ preventScroll: true }); }}>
      <ImagePlus className="size-4 shrink-0 text-slate-400" aria-hidden="true" />从截图生成线框图
    </button>
  </li>;
}

async function readScreenshot(file: File): Promise<ScreenshotPrototypeImage> {
  if (!(SCREENSHOT_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 截图');
  if (!file.size || file.size > SCREENSHOT_MAX_BYTES) throw new Error('每张截图不能超过 8 MB，且不能为空');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('截图读取失败，请重新添加'));
    reader.onabort = () => reject(new Error('截图读取已取消'));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.onload = null; image.onerror = null; resolve(); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error('截图内容无效，请重新添加')); };
    image.src = dataUrl;
  });
  return { name: file.name.slice(0, 200), dataUrl };
}

export const ScreenshotPrototypeComposer = forwardRef<HTMLTextAreaElement, {
  controller?: ScreenshotPrototypeController;
  onOpenAISettings?: () => void;
}>(function ScreenshotPrototypeComposer({ controller, onOpenAISettings }, ref) {
  const request = controller?.state.request;
  const [images, setImages] = useState<ScreenshotPrototypeImage[]>(request?.images || []);
  const [title, setTitle] = useState(request?.title || '');
  const [instructions, setInstructions] = useState(request?.instructions || '');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const epoch = useRef(0), readingLock = useRef(false), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => {
    if (request) { setImages(request.images); setTitle(request.title); setInstructions(request.instructions); }
  }, [request]);
  const state = controller?.state;
  const busy = state?.phase === 'preparing' || state?.phase === 'running';
  const frozen = busy || state?.phase === 'error' || state?.phase === 'done';
  const addFiles = async (files: File[]) => {
    if (frozen || readingLock.current || !files.length) return;
    if (images.length + files.length > SCREENSHOT_MAX_COUNT) { setError('最多添加 3 张截图，请先移除部分图片'); return; }
    const current = epoch.current;
    readingLock.current = true; setReading(true); setError('');
    try {
      const added = await Promise.all(files.map(readScreenshot));
      if (epoch.current === current) setImages(previous => [...previous, ...added]);
    } catch (cause) { if (epoch.current === current) setError(cause instanceof Error ? cause.message : '截图读取失败'); }
    finally { if (epoch.current === current) { readingLock.current = false; setReading(false); } }
  };
  const submit = () => {
    if (!controller || reading || frozen) return;
    try { const next = validateScreenshotPrototypeRequest({ images, title, instructions }); setError(''); void controller.generate(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请检查截图'); }
  };
  return (
    <section
      className={`ax-screenshot-composer mt-5 w-full rounded-2xl border bg-white p-4 text-left shadow-sm dark:bg-slate-950 sm:p-5 ${dragging ? 'border-slate-500 ring-2 ring-slate-300 dark:ring-slate-600' : 'border-slate-200 dark:border-slate-700'}`}
      aria-label="截图生成原型" aria-busy={busy || reading} data-screenshot-prototype-composer
      onPaste={event => { const files = getClipboardImageFiles(event.nativeEvent); if (files.length) { event.preventDefault(); void addFiles(files); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!frozen) setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100">从截图生成原型</h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">布局与文案 → 可编辑线框</span>
      </div>
      <label className="sr-only" htmlFor="screenshot-prototype-title">原型名称（可选）</label>
      <input id="screenshot-prototype-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={100} disabled={frozen} placeholder="原型名称（可选）" className="mb-2 w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-slate-400 dark:text-slate-100" />
      <label className="sr-only" htmlFor="screenshot-prototype-instructions">截图补充要求（可选）</label>
      <textarea ref={ref} id="screenshot-prototype-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={6000} disabled={frozen}
        placeholder="在这里粘贴截图，或拖入图片。可以补充希望保留的布局、文案和交互要求…"
        className="min-h-20 w-full resize-y bg-transparent text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-slate-400 dark:text-slate-200"
      />
      {images.length > 0 ? <ul aria-label="已添加截图" className="my-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {images.map((image, index) => <li key={`${index}-${image.name}`} className="relative min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
          <img src={image.dataUrl} alt={`截图 ${index + 1}：${image.name}`} className="h-24 w-full rounded object-contain" />
          <p className="mt-1 truncate pr-5 text-xs text-slate-500 dark:text-slate-400" title={image.name}>{index + 1}. {image.name}</p>
          <button type="button" aria-label={`移除截图 ${index + 1}`} disabled={frozen || reading} onClick={() => { setImages(previous => previous.filter((_, item) => item !== index)); setError(''); }} className="absolute right-1 top-1 rounded-md bg-white p-1 text-slate-500 shadow-sm hover:text-slate-900 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"><X className="size-4" /></button>
        </li>)}
      </ul> : null}
      {reading ? <div className="my-3 h-28 overflow-hidden rounded-lg"><PageSkeleton variant="cards" label="正在读取截图" /></div> : null}
      {busy ? <div className="my-3 h-40 overflow-hidden rounded-lg"><PageSkeleton variant="preview" label={state?.message || '正在生成原型'} /></div> : null}
      {error || state?.error ? <p role="alert" className="my-2 text-xs text-red-600 dark:text-red-400">{error || state?.error}</p> : null}
      {state?.phase === 'done' ? <p role="status" className="my-2 text-xs text-slate-600 dark:text-slate-300">{state.message}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} aria-label="上传截图文件" type="file" accept={SCREENSHOT_MIME_TYPES.join(',')} multiple hidden disabled={frozen || reading} onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
          <button type="button" disabled={frozen || reading || images.length >= SCREENSHOT_MAX_COUNT} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"><ImagePlus className="size-4" />上传截图</button>
          <span className="text-xs text-slate-400">PNG / JPEG / WebP · 最多 3 张 · 每张 8 MB</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state?.phase === 'error' ? <>
            {onOpenAISettings ? <button type="button" onClick={onOpenAISettings} className="text-xs text-slate-500 underline">AI 设置</button> : null}
            <button type="button" onClick={() => { controller?.reset(); setError(''); }} className="rounded-md border px-3 py-2 text-xs dark:border-slate-700 dark:text-slate-300">修改要求</button>
            {state.request ? <button type="button" onClick={() => { void controller?.retry(); }} className="rounded-md bg-slate-800 px-3 py-2 text-xs text-white dark:bg-slate-200 dark:text-slate-950">重试</button> : null}
          </> : state?.phase === 'done' ? <>
            <button type="button" onClick={() => controller?.reset()} className="rounded-md border px-3 py-2 text-xs dark:border-slate-700 dark:text-slate-300">重新开始</button>
            <button type="button" onClick={() => controller?.openPrototype()} className="rounded-md bg-slate-800 px-3 py-2 text-xs text-white dark:bg-slate-200 dark:text-slate-950">打开原型</button>
          </> : <button type="button" aria-label="生成截图原型" disabled={!controller || !images.length || reading || busy} onClick={submit} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white">
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-4" />}{busy ? '生成中…' : '生成原型'}
          </button>}
        </div>
      </div>
    </section>
  );
});
