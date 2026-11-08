import { forwardRef, useState, type IframeHTMLAttributes } from 'react';
import { PageSkeleton } from './page-skeleton';
import type { SkeletonVariant } from '../../common/loadingSkeleton';
import { cn } from '@/lib/utils';
interface Props extends IframeHTMLAttributes<HTMLIFrameElement> { skeletonVariant?: SkeletonVariant }
export const PreviewIframe = forwardRef<HTMLIFrameElement, Props>(function PreviewIframe({
  className, style, skeletonVariant = 'preview', onLoad, onError, ...props
}, ref) {
  const [loaded, setLoaded] = useState<string | null>(null);
  // Hash-only navigation keeps the same document and does not fire onLoad again.
  const source = `${(props.src || '').split('#')[0]}\0${props.srcDoc || ''}`;
  const waiting = loaded !== source;
  return <div className={cn('relative min-h-0 overflow-hidden', className)} style={{ width: '100%', height: '100%', ...style }} aria-busy={waiting}>
    <iframe {...props} ref={ref} tabIndex={waiting ? -1 : props.tabIndex} aria-hidden={waiting ? true : props['aria-hidden']} className="block h-full w-full border-0" style={{ width: '100%', height: '100%', border: 0 }}
      onLoad={event => { setLoaded(source); onLoad?.(event); }} onError={event => { setLoaded(source); onError?.(event); }} />
    {waiting ? <div className="absolute inset-0 z-10 overflow-hidden bg-background"><PageSkeleton variant={skeletonVariant} label={`正在加载${props.title || '预览'}`} /></div> : null}
  </div>;
});
