import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveDocumentCommentStorage, resolvePrototypeCommentStorage } from '../documentCommentsStorage.ts';

import { importReferencePage } from '../referencePages.ts';

const roots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-document-comments-storage-'));
  fs.mkdirSync(path.join(root, 'src/prototypes/home'), { recursive: true });
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('prototype comment storage', () => {
  it('uses the same canonical comment file and asset root for author and published requests', () => {
    const root = createRoot();
    const author = resolvePrototypeCommentStorage(root, 'prototypes/home');
    const published = resolvePrototypeCommentStorage(root, 'prototypes/home', {
      publishedShareId: 'share-a',
    });

    expect(author).not.toBeNull();
    expect(published).not.toBeNull();
    expect(author?.commentFilePath).toBe(published?.commentFilePath);
    expect(published?.projectRelativeCommentPath).toContain('.axhub/make/comments/');
    expect(published?.projectRelativeAssetRoot).toContain('.axhub/make/comment-assets/');
  });

  it('ignores published share ids for storage path resolution', () => {
    const root = createRoot();
    expect(resolvePrototypeCommentStorage(root, 'prototypes/home', { publishedShareId: '../escape' })).not.toBeNull();
    expect(resolvePrototypeCommentStorage(root, 'prototypes/home', { publishedShareId: 'Share-A' })).not.toBeNull();
  });

  it('rejects a canonical storage parent when it is a symbolic link', () => {
    if (process.platform === 'win32') return;
    const root = createRoot();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-document-comments-outside-'));
    roots.push(outsideRoot);
    fs.mkdirSync(path.join(root, '.axhub/make'), { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(root, '.axhub/make/comments'), 'dir');

    expect(resolvePrototypeCommentStorage(root, 'prototypes/home', {
      publishedShareId: 'share-a',
    })).toBeNull();
  });
});

describe('imported reference document comments', () => {
  it('allows existing cached reference HTML and rejects protected or fictitious cache paths', async () => {
    const root = createRoot();
    const page = await importReferencePage(root, { filename: 'page.html', data: Buffer.from('<p>component</p>') });
    const documentPath = `.axhub/make/references/${page.id}/files/${page.entryPath}`;
    expect(resolveDocumentCommentStorage(root, documentPath)?.documentPath).toBe(documentPath);
    expect(resolveDocumentCommentStorage(root, '.axhub/make/config.html')).toBeNull();
    expect(resolveDocumentCommentStorage(root, `.axhub/make/references/${page.id}/files/missing.html`)).toBeNull();
    fs.unlinkSync(path.join(root, documentPath));
    fs.symlinkSync('/etc/passwd', path.join(root, documentPath));
    expect(resolveDocumentCommentStorage(root, documentPath)).toBeNull();
  });
});
