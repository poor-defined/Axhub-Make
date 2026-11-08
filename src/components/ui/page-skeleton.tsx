import { renderLoadingSkeleton, type SkeletonVariant } from '../../common/loadingSkeleton';
import { cn } from '@/lib/utils';
export function PageSkeleton({ variant = 'preview', label = '正在加载内容', className }: { variant?: SkeletonVariant; label?: string; className?: string }) {
  // Layouts are application-owned; the shared renderer escapes the only variable text.
  return <div className={cn('h-full min-h-0 w-full overflow-hidden', className)} data-page-skeleton={variant} dangerouslySetInnerHTML={{ __html: renderLoadingSkeleton(variant, label) }} />;
}
