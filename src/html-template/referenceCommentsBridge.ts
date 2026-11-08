import type {
  PrototypeEditCommentsDocument,
  PrototypeEditCommentsPersistenceAdapter,
  PrototypeEditCommentsWriteContext,
  PrototypeEditCommentsWriteReason,
} from '@axhub/commentary';

/** Opaque reference documents may only persist comments through their fixed-resource parent. */
export function createReferenceCommentsBridge(
  getTrustedParentOrigin: () => string,
): PrototypeEditCommentsPersistenceAdapter {
  const request = async (
    operation: 'read' | 'write',
    options: {
      document?: PrototypeEditCommentsDocument;
      reason?: PrototypeEditCommentsWriteReason;
      observedTombstones?: PrototypeEditCommentsWriteContext['observedTombstones'];
    } = {},
  ): Promise<PrototypeEditCommentsDocument | null> => {
    const origin = getTrustedParentOrigin();
    if (!origin || window.parent === window) throw new Error('参考页尚未建立可信父页面连接。');
    const requestId = `reference-comments-${globalThis.crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const finish = (error?: string, document?: PrototypeEditCommentsDocument | null) => {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(new Error(error));
        else resolve(document ?? null);
      };
      const onMessage = (event: MessageEvent) => {
        if (
          event.source !== window.parent ||
          event.origin !== origin ||
          event.data?.type !== 'AXHUB_REFERENCE_COMMENTS_RESULT' ||
          event.data.requestId !== requestId
        )
          return;
        if (event.data.success !== true) finish(String(event.data.error || '参考页批注保存失败。'));
        else finish(undefined, event.data.document);
      };
      const timer = window.setTimeout(() => finish('参考页批注请求超时，请重试。'), 15_000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage(
        { type: 'AXHUB_REFERENCE_COMMENTS_REQUEST', requestId, operation, ...options },
        origin,
      );
    });
  };
  return {
    read: () => request('read'),
    write: async (_scope, document, reason, context) => {
      await request('write', {
        document,
        reason,
        ...(context?.observedTombstones?.length
          ? { observedTombstones: context.observedTombstones }
          : {}),
      });
    },
  };
}
