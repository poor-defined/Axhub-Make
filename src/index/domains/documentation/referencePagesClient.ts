export interface ReferencePage {
  id: string;
  title: string;
  entryPath: string;
  htmlFiles: string[];
  createdAt: string;
  sourceUrl?: string;
  sourceDirectory?: string;
  sourceFingerprint?: string;
  sourceModifiedAt?: string;
  updatedAt?: string;
  cacheDirectory?: string;
  warnings: string[];
  previewUrl: string;
}
export interface LocalReferenceStatus {
  directory?: string;
  suppressed?: boolean;
  error?: string;
}
export async function referenceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '请求失败');
  return body;
}
export function referenceDocumentPath(page: ReferencePage, entryPath = page.entryPath) {
  return `.axhub/make/references/${page.id}/files/${entryPath}`;
}
export function referencePreviewUrl(page: ReferencePage, entryPath = page.entryPath) {
  const base = page.previewUrl.slice(0, page.previewUrl.indexOf('/files/') + 7);
  return base + entryPath.split('/').map(encodeURIComponent).join('/');
}
