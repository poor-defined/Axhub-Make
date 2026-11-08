import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePath } from 'vite';

type ViteConfig = {
  cacheDir?: string;
  plugins?: Array<{ name: string; handleHotUpdate?: unknown }>;
  resolve?: {
    alias?: Array<{ find: string | RegExp; replacement: string }>;
  };
  server?: {
    headers?: Record<string, string>;
    watch?: {
      ignored?: string[];
    };
  };
};

function createRequest(url: string) {
  return {
    method: 'GET',
    url,
    headers: {},
    pipe: vi.fn(),
  } as any;
}

function createResponse() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();
  const response: any = {
    statusCode: 200,
    statusMessage: '',
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
      return response;
    }),
    getHeader: vi.fn((name: string) => headers.get(name.toLowerCase())),
    hasHeader: vi.fn((name: string) => headers.has(name.toLowerCase())),
    removeHeader: vi.fn((name: string) => {
      headers.delete(name.toLowerCase());
    }),
    writeHead: vi.fn((statusCode: number, statusMessageOrHeaders?: string | Record<string, string>) => {
      response.statusCode = statusCode;
      response.headersSent = true;
      if (typeof statusMessageOrHeaders === 'string') {
        response.statusMessage = statusMessageOrHeaders;
      }
      return response;
    }),
    write: vi.fn((chunk?: string | Buffer | Uint8Array) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return true;
    }),
    end: vi.fn((chunk?: string | Buffer | Uint8Array) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      response.writableEnded = true;
      return response;
    }),
  };

  return {
    response,
    body: () => Buffer.concat(chunks).toString('utf8'),
    header: (name: string) => headers.get(name.toLowerCase()) || '',
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('vite');
});

describe('make-server Vite dev middleware', () => {
  it('invalidates cached commentary and reloads preview clients after a runtime rebuild, with watcher cleanup', async () => {
    vi.useFakeTimers();
    const makeServerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-vite-commentary-rebuild-'));
    const runtimePath = path.join(makeServerRoot, 'vendor/axhub-commentary/dist/index.mjs');
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, 'export const version = 1;');
    let onChange!: (current: fs.Stats, previous: fs.Stats) => void;
    const watch = vi.spyOn(fs, 'watchFile').mockImplementation(((file: string, _options: unknown, callback: typeof onChange) => {
      expect(file).toBe(runtimePath); onChange = callback;
      return {} as fs.StatWatcher;
    }) as typeof fs.watchFile);
    const unwatch = vi.spyOn(fs, 'unwatchFile').mockImplementation(() => {});
    const invalidateAll = vi.fn(), send = vi.fn();
    vi.doMock('vite', () => ({ normalizePath, createServer: vi.fn(async () => ({
      middlewares: vi.fn(), transformIndexHtml: vi.fn(), close: vi.fn(), moduleGraph: { invalidateAll }, ws: { send },
    })) }));
    try {
      const { createViteDevMiddleware } = await import('../viteDevServer.ts');
      const middleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
      expect(watch).toHaveBeenCalledOnce();
      onChange({ mtimeMs: 2, size: 30 } as fs.Stats, { mtimeMs: 1, size: 20 } as fs.Stats);
      onChange({ mtimeMs: 3, size: 40 } as fs.Stats, { mtimeMs: 2, size: 30 } as fs.Stats);
      await vi.advanceTimersByTimeAsync(500);
      expect(invalidateAll).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
      await middleware.close();
      expect(unwatch).toHaveBeenCalledWith(runtimePath, onChange);
    } finally { fs.rmSync(makeServerRoot, { recursive: true, force: true }); }
  });
  it('removes stale embedded Vite cache directories before starting a new session', async () => {
    const makeServerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-vite-dev-cache-'));
    const viteCacheRoot = path.join(makeServerRoot, 'node_modules', '.vite');
    const staleCacheDir = path.join(viteCacheRoot, 'axhub-make-dev-999999-stale');
    const livePidCacheDir = path.join(viteCacheRoot, `axhub-make-dev-${process.pid}-live`);
    fs.mkdirSync(staleCacheDir, { recursive: true });
    fs.mkdirSync(livePidCacheDir, { recursive: true });
    const close = vi.fn();
    const createServer = vi.fn(async (_config: ViteConfig) => ({
      middlewares: vi.fn(),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      close,
    }));
    vi.doMock('vite', () => ({ createServer, normalizePath }));

    try {
      const { createViteDevMiddleware } = await import('../viteDevServer.ts');
      const middleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
      const config = createServer.mock.calls[0]?.[0] as ViteConfig;

      expect(fs.existsSync(staleCacheDir)).toBe(false);
      expect(fs.existsSync(livePidCacheDir)).toBe(true);
      expect(config.cacheDir).toContain(`axhub-make-dev-${process.pid}-`);

      await middleware.close();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(makeServerRoot, { recursive: true, force: true });
    }
  });

  it('disables persistent browser caching without changing the optimizer config per start', async () => {
    const createServer = vi.fn(async (_config: ViteConfig) => ({
      middlewares: vi.fn(),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      close: vi.fn(),
    }));
    vi.doMock('vite', () => ({ createServer, normalizePath }));

    const { createViteDevMiddleware } = await import('../viteDevServer.ts');
    const makeServerRoot = path.resolve(__dirname, '../..');

    const firstMiddleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
    const secondMiddleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);

    try {
      const firstConfig = createServer.mock.calls[0]?.[0] as ViteConfig;
      const secondConfig = createServer.mock.calls[1]?.[0] as ViteConfig;
      const expectedCachePrefix = path.join(makeServerRoot, 'node_modules', '.vite', `axhub-make-dev-${process.pid}-`);

      expect(firstConfig.server?.headers?.['Cache-Control']).toBe('no-store');
      expect(secondConfig.server?.headers?.['Cache-Control']).toBe('no-store');
      expect(firstConfig.server?.watch?.ignored).toEqual(expect.arrayContaining([
        '**/.axhub/**',
        '**/.spec/**',
        '**/client/**',
        '**/dist/**',
        '**/src/server/**',
        '**/*.excalidraw',
        '**/*.assets/**',
      ]));
      expect(firstConfig.plugins?.some((plugin) => (
        plugin.name === 'axhub-canvas-hot-update-filter'
        && typeof plugin.handleHotUpdate === 'function'
      ))).toBe(true);
      const hotUpdateFilter = firstConfig.plugins?.find((plugin) => (
        plugin.name === 'axhub-canvas-hot-update-filter'
      ));
      await expect(Promise.resolve((hotUpdateFilter?.handleHotUpdate as any)?.({
        file: path.join(makeServerRoot, 'client/src/prototypes/home/annotation-source.json'),
        modules: [{ id: 'annotation-source' }],
      }))).resolves.toEqual([]);
      expect(firstConfig.cacheDir?.startsWith(expectedCachePrefix)).toBe(true);
      expect(secondConfig.cacheDir?.startsWith(expectedCachePrefix)).toBe(true);
      expect(secondConfig.cacheDir).not.toBe(firstConfig.cacheDir);
      expect(firstConfig.plugins?.some((plugin) => plugin.name.startsWith('axhub-make-dev-session-'))).not.toBe(true);
      expect(secondConfig.plugins?.some((plugin) => plugin.name.startsWith('axhub-make-dev-session-'))).not.toBe(true);
    } finally {
      await firstMiddleware.close();
      await secondMiddleware.close();
    }
  });

  it('aliases the embedded commentary runtime to the vendored dist entry', async () => {
    const makeServerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-vite-dev-commentary-'));
    fs.mkdirSync(path.join(makeServerRoot, 'vendor/axhub-commentary/dist'), { recursive: true });
    fs.writeFileSync(
      path.join(makeServerRoot, 'vendor/axhub-commentary/dist/index.mjs'),
      'export const commentaryRuntime = true;\n',
      'utf8',
    );
    const createServer = vi.fn(async (_config: ViteConfig) => ({
      middlewares: vi.fn(),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      close: vi.fn(),
    }));
    vi.doMock('vite', () => ({ createServer, normalizePath }));

    try {
      const { createViteDevMiddleware } = await import('../viteDevServer.ts');
      const middleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
      const config = createServer.mock.calls[0]?.[0] as ViteConfig;
      const commentaryAlias = config.resolve?.alias?.find((alias) => String(alias.find) === '/^@axhub\\/commentary$/');

      expect(commentaryAlias?.replacement).toBe(path.join(makeServerRoot, 'vendor/axhub-commentary/dist/index.mjs'));

      await middleware.close();
    } finally {
      fs.rmSync(makeServerRoot, { recursive: true, force: true });
    }
  });

  it('recreates Vite middleware once when an optimized dep request is stale', async () => {
    let createdServers = 0;
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const createServer = vi.fn(async (_config: ViteConfig) => {
      createdServers += 1;
      const serverNumber = createdServers;
      return {
        middlewares: vi.fn((req: any, res: any) => {
          if (serverNumber === 1) {
            res.statusCode = 504;
            res.statusMessage = 'Outdated Optimize Dep';
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript');
          res.end(`export const recovered = ${JSON.stringify(req.url)};`);
        }),
        transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
        close: serverNumber === 1 ? firstClose : secondClose,
      };
    });
    vi.doMock('vite', () => ({ createServer, normalizePath }));

    const { createViteDevMiddleware } = await import('../viteDevServer.ts');
    const makeServerRoot = path.resolve(__dirname, '../..');
    const middleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
    const firstConfig = createServer.mock.calls[0]?.[0] as ViteConfig;
    const cacheDirName = path.basename(firstConfig.cacheDir || '');
    const { response, body } = createResponse();

    await middleware.handle(
      createRequest(`/node_modules/.vite/${cacheDirName}/deps/react.js?v=abc`),
      response,
    );

    expect(createServer).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(body()).toContain('recovered');

    await middleware.close();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/assets/dev-template-bootstrap.js', '/src/dev-template/index.tsx'],
    ['/assets/spec-template-styles.js', '/src/spec-template/styles.ts'],
    ['/assets/spec-template-bootstrap.js', '/src/spec-template/index.tsx'],
    ['/assets/canvas-template-bootstrap.js', '/src/canvas-template/index.tsx'],
    ['/assets/html-template-bootstrap.js', '/src/html-template/index.tsx'],
    ['/assets/runtime-export-core.js', '/src/runtime-export-core.ts'],
    ['/assets/runtime-export-core.js?v=0.3.0', '/src/runtime-export-core.ts'],
    ['/assets/axure-export-runtime.js', '/src/axure-export-runtime.ts'],
  ])('serves production entry asset %s from source in dev mode', async (assetUrl, sourceUrl) => {
    let handledUrl = '';
    const close = vi.fn();
    const createServer = vi.fn(async (_config: ViteConfig) => ({
      middlewares: vi.fn((req: any, res: any) => {
        handledUrl = req.url;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`export const runtimeEntry = ${JSON.stringify(req.url)};`);
      }),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      close,
    }));
    vi.doMock('vite', () => ({ createServer, normalizePath }));

    const { createViteDevMiddleware } = await import('../viteDevServer.ts');
    const makeServerRoot = path.resolve(__dirname, '../..');
    const middleware = await createViteDevMiddleware(http.createServer(), makeServerRoot);
    const { response, body, header } = createResponse();

    await middleware.handle(
      createRequest(assetUrl),
      response,
    );

    expect(handledUrl).toBe(sourceUrl);
    expect(response.statusCode).toBe(200);
    expect(header('content-type')).toContain('application/javascript');
    expect(body()).toContain(sourceUrl);

    await middleware.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
