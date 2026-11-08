import React from 'react';
import { useHostedCommentList } from './useHostedCommentList';

export function CommentListWorkspace(props: {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  resourceKey: string;
  active: boolean;
  children: (docked: boolean) => React.ReactNode;
}) {
  const dock = useHostedCommentList(props.frameRef, props.resourceKey, props.active);
  return <div data-prototype-preview-workspace="true" className="relative h-full w-full min-h-0 min-w-0"
    style={{ position: 'relative', height: '100%', width: '100%', minHeight: 0, minWidth: 0 }}>
    {props.children(dock.open)}{dock.panel}
  </div>;
}
