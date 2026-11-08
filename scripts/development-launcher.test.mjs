import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { prepareDevelopmentEnvironment, archiveDeadAdminRecord } from './development-launcher.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'make-launcher-'));
  roots.push(root);
  const write = (name, value = 'initial') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  write('package.json', '{}');
  write('pnpm-lock.yaml');
  write('src/index/app.tsx');
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'install') write('node_modules/.bin/tsx');
    if (args[0] === 'vendor:build:commentary') write('vendor/axhub-commentary/dist/index.mjs');
    if (args[0] === 'admin:build') {
      write('dist/admin/index.html');
      write('dist/admin/assets/spec-template-bootstrap.js');
      write('dist/admin/assets/axure-export-runtime.js');
    }
  };
  return { root, write, calls, run };
}

test('a second launch skips installation and builds when inputs and outputs are unchanged', () => {
  const f = fixture();
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, ['install --frozen-lockfile', 'vendor:build:commentary', 'admin:build']);
  f.calls.length = 0;
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, []);
});

test('source edits including uncommitted files invalidate the build without reinstalling dependencies', () => {
  const f = fixture();
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  f.calls.length = 0;
  f.write('src/index/new-view.tsx', 'changed');
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, ['vendor:build:commentary', 'admin:build']);
});

test('a changed lockfile reinstalls dependencies and rebuilds', () => {
  const f = fixture();
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  f.calls.length = 0;
  f.write('pnpm-lock.yaml', 'new dependencies');
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, ['install --frozen-lockfile', 'vendor:build:commentary', 'admin:build']);
});

test('deleted or externally changed build output triggers repair', () => {
  const f = fixture();
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  f.calls.length = 0;
  fs.unlinkSync(path.join(f.root, 'dist/admin/assets/spec-template-bootstrap.js'));
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, ['vendor:build:commentary', 'admin:build']);
});

test('a failed build never caches success and the next launch retries it', () => {
  const f = fixture();
  assert.throws(() => prepareDevelopmentEnvironment(f.root, { run(args) {
    f.run(args);
    if (args[0] === 'admin:build') throw new Error('build failed');
  } }), /build failed/);
  f.calls.length = 0;
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.ok(f.calls.includes('admin:build'));
});

test('local state and logs do not invalidate build cache', () => {
  const f = fixture();
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  f.calls.length = 0;
  f.write('.local/development-home/projects.json', 'new state');
  f.write('docs/notes.md', 'notes');
  prepareDevelopmentEnvironment(f.root, { run: f.run });
  assert.deepEqual(f.calls, []);
});

test('archives a dead legacy admin record even when its root was overwritten by a client', () => {
  const f = fixture();
  const state = path.join(f.root, '.local/development-home/.axhub/make');
  f.write('.local/development-home/.axhub/make/.admin-server-info.json', JSON.stringify({ pid: 123, projectRoot: '/old/client' }));
  assert.equal(archiveDeadAdminRecord(state, () => false), true);
  assert.equal(fs.existsSync(path.join(state, '.admin-server-info.json')), false);
  assert.equal(fs.readdirSync(state).filter(name => name.includes('.stale-')).length, 1);
});

test('never removes a live or malformed admin record', () => {
  const f = fixture();
  const record = '.local/development-home/.axhub/make/.admin-server-info.json';
  const state = path.dirname(path.join(f.root, record));
  f.write(record, JSON.stringify({ pid: 123 }));
  assert.equal(archiveDeadAdminRecord(state, () => true), false);
  f.write(record, 'invalid');
  assert.equal(archiveDeadAdminRecord(state, () => false), false);
  assert.equal(fs.existsSync(path.join(f.root, record)), true);
});

test('starts only the selected Make client using the projects API runtimeStatus field', async (t) => {
  const { ensureActiveClient } = await import('./development-launcher.mjs');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([String(url), options?.method || 'GET']);
    const data = String(url).endsWith('/api/projects')
      ? { activeProjectId: 'selected', projects: [
        { id: 'selected', runtimeStatus: { makeClient: true } },
        { id: 'other', runtimeStatus: { makeClient: true } },
      ] }
      : String(url).endsWith('/status') ? { running: false } : { success: true };
    return new Response(JSON.stringify(data));
  });
  await ensureActiveClient('http://localhost:53818');
  assert.deepEqual(calls, [
    ['http://localhost:53818/api/projects', 'GET'],
    ['http://localhost:53818/api/projects/selected/dev/status', 'GET'],
    ['http://localhost:53818/api/projects/selected/dev/ensure', 'POST'],
  ]);
});

test('does not start a client that is already running', async (t) => {
  const { ensureActiveClient } = await import('./development-launcher.mjs');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(String(url).endsWith('/api/projects')
      ? { activeProjectId: 'selected', projects: [{ id: 'selected', runtimeStatus: { makeClient: true } }] }
      : { running: true }));
  });
  await ensureActiveClient('http://localhost:53818');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.endsWith('/ensure')));
});
