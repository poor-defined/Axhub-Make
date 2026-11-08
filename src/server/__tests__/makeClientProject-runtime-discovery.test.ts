import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMakeClientMarkerPath,
  getRuntimeServerInfoPath,
  readServerInfo,
} from '../projectCore/index.ts';
import { ensureMakeClientDevServer, getMakeClientDevStatus } from '../makeClientProject.ts';

const tempRoots: string[] = [];

function createTempRoot(prefix = 'axhub-make-client-runtime-discovery-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeMakeClientMarker(projectRoot: string, id = 'runtime-discovery-client') {
  writeJson(getMakeClientMarkerPath(projectRoot), {
    schemaVersion: 1,
    kind: 'axhub-make-client',
    repository: 'https://github.com/lintendo/Axhub-Make/tree/main/client',
    project: { id, name: 'Runtime Discovery Client' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('make client runtime discovery', () => {
  it('finds a running client from runtime health when the server info file is missing', async () => {
    const projectRoot = createTempRoot();
    writeMakeClientMarker(projectRoot);
    const runtimeOrigin = 'http://localhost:51724';
    const runtimePayload = {
      pid: 12345,
      port: 51724,
      host: 'localhost',
      origin: runtimeOrigin,
      projectRoot,
      startedAt: '2026-05-28T03:54:46.722Z',
      timestamp: '2026-05-28T03:54:46.722Z',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === `${runtimeOrigin}/api/health`) {
        return new Response(JSON.stringify({
          ok: true,
          role: 'runtime',
          projectRoot,
          server: runtimePayload,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const status = await getMakeClientDevStatus('runtime-discovery-client', projectRoot);

    expect(status).toMatchObject({
      projectId: 'runtime-discovery-client',
      makeClient: true,
      running: true,
      runtime: {
        origin: runtimeOrigin,
        projectRoot,
      },
    });
    expect(status.reason).toBeUndefined();
    expect(readServerInfo(projectRoot, 'runtime')).toMatchObject({
      origin: runtimeOrigin,
      projectRoot,
    });
    expect(fetchSpy).toHaveBeenCalledWith(new URL('/api/health', runtimeOrigin), expect.any(Object));
  });

  it('reuses a discovered client without replacing the global admin service identity', async () => {
    const projectRoot = createTempRoot();
    const homeDir = createTempRoot('axhub-admin-home-');
    const adminServerInfo = {
      pid: process.pid,
      port: 53818,
      host: 'localhost',
      origin: 'http://localhost:53818',
      projectRoot: path.join(homeDir, '.axhub', 'make'),
      startedAt: '2026-05-28T03:54:46.722Z',
    };
    writeMakeClientMarker(projectRoot);
    writeJson(path.join(projectRoot, 'package.json'), {
      scripts: {
        dev: 'vite',
        'metadata:sync': 'node scripts/sync-project-metadata.mjs',
      },
    });
    const runtimeOrigin = 'http://localhost:51724';
    const runtimePayload = {
      pid: 12345,
      port: 51724,
      host: 'localhost',
      origin: runtimeOrigin,
      projectRoot,
      startedAt: '2026-05-28T03:54:46.722Z',
      timestamp: '2026-05-28T03:54:46.722Z',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === `${runtimeOrigin}/api/health`) {
        return new Response(JSON.stringify({
          ok: true,
          role: 'runtime',
          projectRoot,
          server: runtimePayload,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    const spawn = vi.fn();
    const runCommand = vi.fn();

    const result = await ensureMakeClientDevServer(projectRoot, {
      adminServerInfo,
      serverInfoHomeDir: homeDir,
      commandRunner: {
        runCommand,
        spawn: spawn as any,
      },
    });

    expect(result).toMatchObject({
      success: true,
      reused: true,
      phase: 'ready',
      runtime: {
        origin: runtimeOrigin,
        projectRoot,
      },
    });
    expect(readServerInfo(projectRoot, 'runtime')).toMatchObject({
      origin: runtimeOrigin,
      projectRoot,
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(readServerInfo(projectRoot, 'admin', { homeDir })).toEqual(adminServerInfo);
  });

  it('accepts runtime info written with a realpath-equivalent project root after spawning dev', async () => {
    const projectRoot = createTempRoot();
    writeMakeClientMarker(projectRoot);
    writeJson(path.join(projectRoot, 'package.json'), {
      scripts: {
        dev: 'vite',
        'metadata:sync': 'node scripts/sync-project-metadata.mjs',
      },
    });
    const viteRoot = path.join(projectRoot, 'node_modules', 'vite');
    writeJson(path.join(viteRoot, 'package.json'), { bin: { vite: 'bin/vite.js' } });
    writeJson(path.join(viteRoot, 'bin', 'vite.js'), '');

    const realProjectRoot = fs.realpathSync.native(projectRoot);
    if (realProjectRoot === path.resolve(projectRoot)) {
      return;
    }

    const spawn = vi.fn((_file: string, _args: string[], options: { cwd?: string }) => {
      const targetRoot = String(options.cwd || '');
      setTimeout(() => {
        writeJson(path.join(targetRoot, '.axhub', 'make', '.dev-server-info.json'), {
          pid: process.pid,
          port: 51729,
          host: 'localhost',
          origin: 'http://localhost:51729',
          projectRoot: realProjectRoot,
          startedAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        });
      }, 0);
      return {
        once: vi.fn(),
        unref: vi.fn(),
      } as any;
    });
    const runCommand = vi.fn();

    const result = await ensureMakeClientDevServer(projectRoot, {
      commandRunner: {
        runCommand,
        spawn: spawn as any,
      },
      devTimeoutMs: 250,
      pollIntervalMs: 5,
    });

    expect(result).toMatchObject({
      success: true,
      reused: false,
      phase: 'ready',
      runtime: {
        origin: 'http://localhost:51729',
      },
    });
  });

  it('captures spawned dev server output when diagnostic logging is enabled', async () => {
    const projectRoot = createTempRoot();
    writeMakeClientMarker(projectRoot);
    writeJson(path.join(projectRoot, 'package.json'), {
      scripts: {
        dev: 'vite',
        'metadata:sync': 'node scripts/sync-project-metadata.mjs',
      },
    });
    const viteRoot = path.join(projectRoot, 'node_modules', 'vite');
    writeJson(path.join(viteRoot, 'package.json'), { bin: { vite: 'bin/vite.js' } });
    writeJson(path.join(viteRoot, 'bin', 'vite.js'), '');

    const logLines: string[] = [];
    const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
    const stderrHandlers: Array<(chunk: Buffer) => void> = [];
    const spawn = vi.fn((_file: string, _args: string[], options: { cwd?: string; stdio?: unknown }) => {
      expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
      const targetRoot = String(options.cwd || '');
      setTimeout(() => {
        stdoutHandlers.forEach((handler) => handler(Buffer.from('dev stdout\n')));
        stderrHandlers.forEach((handler) => handler(Buffer.from('dev stderr\n')));
        writeJson(path.join(targetRoot, '.axhub', 'make', '.dev-server-info.json'), {
          pid: process.pid,
          port: 51731,
          host: 'localhost',
          origin: 'http://localhost:51731',
          projectRoot: targetRoot,
          startedAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        });
      }, 0);
      return {
        once: vi.fn(),
        unref: vi.fn(),
        stdout: {
          on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandlers.push(handler);
            }
          }),
        },
        stderr: {
          on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
            if (event === 'data') {
              stderrHandlers.push(handler);
            }
          }),
        },
      } as any;
    });

    const result = await ensureMakeClientDevServer(projectRoot, {
      commandRunner: {
        runCommand: vi.fn(),
        spawn: spawn as any,
      },
      diagnosticLog: {
        write: (line: string) => {
          logLines.push(line);
        },
      },
      devTimeoutMs: 250,
      pollIntervalMs: 5,
    });

    expect(result).toMatchObject({
      success: true,
      reused: false,
      phase: 'ready',
      runtime: {
        origin: 'http://localhost:51731',
      },
    });
    expect(logLines.join('\n')).toContain('[make-client:dev:stdout]');
    expect(logLines.join('\n')).toContain('dev stdout');
    expect(logLines.join('\n')).toContain('[make-client:dev:stderr]');
    expect(logLines.join('\n')).toContain('dev stderr');
  });

  it('reports local runtime info as running when the recorded project root is realpath-equivalent', async () => {
    const projectRoot = createTempRoot();
    writeMakeClientMarker(projectRoot, 'realpath-runtime-client');
    const realProjectRoot = fs.realpathSync.native(projectRoot);
    if (realProjectRoot === path.resolve(projectRoot)) {
      return;
    }
    writeJson(getRuntimeServerInfoPath(projectRoot), {
      pid: process.pid,
      port: 51730,
      host: 'localhost',
      origin: 'http://localhost:51730',
      projectRoot: realProjectRoot,
      startedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));

    const status = await getMakeClientDevStatus('realpath-runtime-client', projectRoot, {
      healthTimeoutMs: 1,
    });

    expect(status).toMatchObject({
      projectId: 'realpath-runtime-client',
      makeClient: true,
      running: true,
      runtime: {
        origin: 'http://localhost:51730',
      },
    });
    expect(status.reason).toBeUndefined();
  });
});
