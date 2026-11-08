/** Shared by the browser runtime and server; deliberately has no runtime dependencies. */
interface CleanupComment {
  id?: unknown;
  elementKey?: unknown;
  purpose?: unknown;
  componentComment?: unknown;
  comment?: unknown;
  skillIds?: unknown;
  textChange?: unknown;
  styleChanges?: unknown;
  tweak?: unknown;
  deletedAt?: unknown;
  author?: unknown;
  externalComments?: unknown;
  voiceCreateOperationId?: unknown;
  voiceElementKey?: unknown;
  voiceTargetRef?: unknown;
  linkedAnnotationId?: unknown;
}
interface CleanupImage { commentId?: unknown }

export function clearLegacyComponentComments<T extends { kind?: unknown; comments: CleanupComment[]; images: CleanupImage[] }>(document: T): { document: T; changed: boolean } {
  if (document.kind !== 'prototype-edit-comments') return { document, changed: false };
  const imageOwners = new Set(document.images.map(image => image.commentId));
  const preservedImageOwners = new Set<unknown>();
  const comments: CleanupComment[] = [];
  let changed = false;
  for (const entry of document.comments) {
    const protectedRecord = entry.componentComment === true || (typeof entry.purpose === 'string' && Boolean(entry.purpose.trim()))
      || (typeof entry.elementKey === 'string' && /^(text-comment::|annotation-panel:)/u.test(entry.elementKey))
      || entry.author || entry.voiceCreateOperationId || entry.voiceElementKey || entry.voiceTargetRef || entry.linkedAnnotationId
      || (Array.isArray(entry.externalComments) && entry.externalComments.length > 0);
    if (protectedRecord) { comments.push(entry); preservedImageOwners.add(entry.id); continue; }
    // Existing tombstones still protect against stale clients recreating deleted records.
    if (Number(entry.deletedAt) > 0) { comments.push(entry); continue; }
    if (entry.textChange || entry.styleChanges || entry.tweak) {
      const { comment: _comment, skillIds: _skillIds, ...edit } = entry;
      comments.push(edit);
      changed ||= entry.comment !== undefined || entry.skillIds !== undefined || imageOwners.has(entry.id);
    } else { changed = true; }
  }
  const images = document.images.filter(image => preservedImageOwners.has(image.commentId));
  changed ||= images.length !== document.images.length;
  return changed ? { document: { ...document, comments, images } as T, changed } : { document, changed: false };
}
