import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const dependencyInputs = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'client/package.json'];
const buildInputs = ['src', 'assets', 'public', 'vendor', 'scripts', ...dependencyInputs];
const ignoredDirectories = new Set(['node_modules', '.git', '.local', '.cache']);

function fingerprint(root, inputs) {
  const hash = createHash('sha256');
  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    hash.update(`${relative}\0`);
    if (!stat) { hash.update('missing\0'); return; }
    if (stat.isSymbolicLink()) { hash.update(fs.readlinkSync(absolute)); return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!ignoredDirectories.has(name)) visit(path.join(relative, name));
      }
    } else if (stat.isFile()) {
      hash.update(fs.readFileSync(absolute));
    }
    hash.update('\0');
  }
  for (const input of [...new Set(inputs)].sort()) visit(input);
  return hash.digest('hex');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function runPnpm(root, args) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} 失败，退出码：${result.status}`);
}

export function prepareDevelopmentEnvironment(root, { run = args => runPnpm(root, args), log = () => {} } = {}) {
  const cachePath = path.join(root, '.local/development-launcher-cache.json');
  const cache = readJson(cachePath);
  const dependencyHash = fingerprint(root, dependencyInputs);
  const install = !fs.existsSync(path.join(root, 'node_modules/.bin/tsx')) || cache?.dependencies !== dependencyHash;
  if (install) {
    log('依赖声明已更新或尚未初始化，正在同步依赖……');
    run(['install', '--frozen-lockfile']);
  }
  const rootConfigs = fs.readdirSync(root).filter(name => /^(vite\..*|tsconfig.*\.json|.*\.html)$/.test(name) && !name.includes('.timestamp-'));
  const inputs = [...buildInputs, ...rootConfigs];
  const outputs = ['dist/admin', 'vendor/axhub-commentary/dist'];
  const requiredOutputs = ['dist/admin/index.html', 'dist/admin/assets/spec-template-bootstrap.js', 'dist/admin/assets/axure-export-runtime.js', 'vendor/axhub-commentary/dist/index.mjs'];
  const build = install || cache?.source !== fingerprint(root, inputs)
    || requiredOutputs.some(file => !fs.existsSync(path.join(root, file)))
    || cache?.output !== fingerprint(root, outputs);
  if (build) {
    log('代码或构建资源已变化，正在更新批注和管理端资源……');
    run(['vendor:build:commentary']);
    run(['admin:build']);
    if (requiredOutputs.some(file => !fs.existsSync(path.join(root, file)))) throw new Error('构建结束但缺少必要资源，请检查构建日志。');
  } else {
    log('代码及资源未变化，跳过安装和构建。');
  }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ dependencies: dependencyHash, source: fingerprint(root, inputs), output: fingerprint(root, outputs) }));
  return { installed: install, built: build };
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export function archiveDeadAdminRecord(stateDir, alive = isProcessAlive) {
  const file = path.join(stateDir, '.admin-server-info.json');
  const info = readJson(file);
  if (!Number.isInteger(info?.pid) || info.pid <= 0 || alive(info.pid)) return false;
  fs.renameSync(file, path.join(stateDir, `.admin-server-info.stale-${Date.now()}.json`));
  return true;
}

async function getJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), ...options });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  return response.json();
}

async function healthy(origin, stateDir) {
  const health = await getJson(`${origin}/api/health`).catch(() => null);
  return Boolean(health?.ok && health.devMode === true && health.projectRoot === stateDir);
}

export async function ensureActiveClient(origin) {
  const projects = await getJson(`${origin}/api/projects`);
  const project = projects.projects?.find(item => item.id === projects.activeProjectId);
  if (!project?.runtimeStatus?.makeClient || project.unavailable) return;
  const base = `${origin}/api/projects/${encodeURIComponent(project.id)}/dev`;
  const status = await getJson(`${base}/status`);
  if (status.running) { console.log(`原型客户端已就绪：${project.name || project.id}`); return; }
  console.log(`正在启动原型客户端：${project.name || project.id}……`);
  const result = await getJson(`${base}/ensure`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timeoutMs: 60000, pollIntervalMs: 300 }),
    signal: AbortSignal.timeout(180000),
  });
  if (!result.success) throw new Error(result.message || '客户端启动失败');
  console.log('原型客户端已就绪。');
}

async function launch(root) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更高版本。');
  const origin = 'http://127.0.0.1:53818';
  process.env.AXHUB_MAKE_HOME_DIR = path.join(root, '.local/development-home');
  process.env.AXHUB_ASSISTANT_WEB_BASE_URL = 'http://localhost:32125';
  process.env.AXHUB_ASSISTANT_API_BASE_URL = 'http://localhost:32125/api';
  const stateDir = path.join(process.env.AXHUB_MAKE_HOME_DIR, '.axhub/make');
  fs.mkdirSync(stateDir, { recursive: true });
  const lockDir = path.join(root, '.local/development-launcher.lock');
  try { fs.mkdirSync(lockDir); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(path.join(lockDir, 'owner.json'));
    // An ownerless lock may be in the brief interval before its owner file is written.
    const age = Date.now() - fs.statSync(lockDir).mtimeMs;
    if ((!owner && age < 60000) || (Number.isInteger(owner?.pid) && owner.pid > 0 && isProcessAlive(owner.pid))) {
      console.log('开发启动器已在运行，请稍候；就绪后会自动打开浏览器。');
      return;
    }
    fs.rmSync(lockDir, { recursive: true });
    fs.mkdirSync(lockDir);
  }
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid }));
  let child;
  const unlock = () => {
    if (readJson(path.join(lockDir, 'owner.json'))?.pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
  };
  const stop = () => {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  };
  const interrupt = () => { stop(); unlock(); process.exit(130); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const registry = path.join(stateDir, 'projects.json');
    const originalRegistry = path.join(os.homedir(), '.axhub/make/projects.json');
    if (!fs.existsSync(registry) && fs.existsSync(originalRegistry)) fs.copyFileSync(originalRegistry, registry);
    prepareDevelopmentEnvironment(root, { log: console.log });
    if (!await healthy(origin, stateDir)) {
      // Never kill an unknown service occupying the requested port.
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (response) throw new Error('端口 53818 正被其他服务占用，请关闭该服务后重试。');
      if (archiveDeadAdminRecord(stateDir)) console.log('已归档失效的管理服务记录。');
      console.log(`正在启动开发服务：${origin}\n请保持此终端打开；按 Control+C 停止服务。`);
      child = spawn('pnpm', ['server:dev', '--', '--host', '127.0.0.1', '--port', '53818', '--no-open'], {
        cwd: root, stdio: 'inherit', env: process.env, detached: true,
      });
      let spawnError;
      child.once('error', error => { spawnError = error; });
      const deadline = Date.now() + 60000;
      while (!await healthy(origin, stateDir)) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('开发服务提前退出，请检查上方日志。');
        if (Date.now() > deadline) throw new Error('开发服务未在 60 秒内就绪，请检查上方日志。');
        await delay(300);
      }
    } else {
      console.log(`复用当前工作区的开发服务：${origin}`);
    }
    try { await ensureActiveClient(origin); } catch (error) {
      console.warn(`原型客户端未能自动就绪：${error.message}\n管理页面仍可使用，可在页面中重试启动客户端。`);
    }
    const opened = spawnSync('open', [origin], { stdio: 'inherit' });
    if (opened.error || opened.status !== 0) console.warn(`请手动打开 ${origin}`);
  } catch (error) {
    stop();
    throw error;
  } finally {
    unlock();
  }
  if (child) {
    const exitCode = await new Promise(resolve => {
      if (child.exitCode !== null) resolve(child.exitCode);
      else child.once('exit', code => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
  } else {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await launch(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).catch(error => {
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
  });
}
