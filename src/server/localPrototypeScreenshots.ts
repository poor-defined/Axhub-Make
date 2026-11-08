import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { sendFile } from './http.ts';
export interface LocalCaptureRequest { key: string; entry: string; marker: string; }
export interface LocalCaptureResult { key: string; png?: Buffer; error?: string; }
function browserExecutable(): string {
  const configured = process.env.AXHUB_SCREENSHOT_BROWSER;
  if (configured) { if (!fs.existsSync(configured)) throw new Error('AXHUB_SCREENSHOT_BROWSER 指向的浏览器不存在'); return configured; }
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright') : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base).filter(name => /^chromium/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const suffix of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const candidate = path.join(base, entry, suffix); if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  const candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error('未找到截图浏览器。请安装 Chrome，或设置 AXHUB_SCREENSHOT_BROWSER 为 Chromium 可执行文件路径');
  return found;
}
/** A fresh browser profile and a read-only static origin; never attaches to the user's browser. */
export async function captureLocalPrototype(root: string, requests: LocalCaptureRequest[], viewport = { width: 1920, height: 1080 }): Promise<LocalCaptureResult[]> {
  const executable = browserExecutable();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-prd-browser-'));
  const realRoot = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    try {
      const relative = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname).replace(/^\/+/, '');
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep) || !fs.realpathSync(target).startsWith(realRoot + path.sep) || !fs.statSync(target).isFile()) throw new Error('path');
      if (/\.html?$/iu.test(target)) res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-same-origin; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'self'");
      if (!sendFile(res, target, { cacheControl: 'no-store' })) res.writeHead(404).end();
    } catch { res.writeHead(404).end(); }
  });
  let browser: ReturnType<typeof spawn> | undefined;
  let ws: WebSocket | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    browser = spawn(executable, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
    let spawnError: Error | undefined; browser.once('error', error => { spawnError = error; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) {
      if (spawnError) throw spawnError;
      if (browser.exitCode !== null) throw new Error('截图浏览器启动失败');
      await delay(100);
    }
    if (!fs.existsSync(portFile)) throw new Error('截图浏览器启动超时');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    const target = targets.find((entry: any) => entry.type === 'page');
    if (!target) throw new Error('截图浏览器未创建页面');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('浏览器连接超时')), 5000); ws!.once('open', () => { clearTimeout(timer); resolve(); }); ws!.once('error', error => { clearTimeout(timer); reject(error); }); });
    let nextId = 0;
    const call = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`浏览器操作超时：${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const failed = new Set<string>();
    ws.on('message', bytes => {
      const data = JSON.parse(String(bytes));
      if (data.id) {
        const item = pending.get(data.id); if (!item) return;
        pending.delete(data.id); clearTimeout(item.timer);
        if (data.error) item.reject(new Error(data.error.message)); else item.resolve(data.result);
      } else if (data.method === 'Fetch.requestPaused') {
        const p = data.params, url = p.request.url;
        const allowed = url.startsWith(origin + '/') || /^(data:|blob:)/u.test(url);
        void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      } else if (data.method === 'Network.responseReceived' && data.params.response.status >= 400) failed.add(data.params.response.url);
    });
    ws.on('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('截图浏览器连接已关闭')); } pending.clear(); });
    const evaluate = async (expression: string) => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description || result.exceptionDetails.text).split('\n')[0].replace(/^Error:\s*/u, ''));
      return result.result.value;
    };
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    const results: LocalCaptureResult[] = [];
    let capturedBytes = 0;
    let loadedEntry = '';
    const deadline = Date.now() + 3 * 60 * 1000;
    for (const request of requests) {
      try {
        if (Date.now() > deadline) throw new Error('本批截图已超过三分钟，请缩小范围重试');
        if (request.entry !== loadedEntry) {
        failed.clear();
        await call('Page.navigate', { url: `${origin}/${request.entry.split('/').map(encodeURIComponent).join('/')}` });
        let ready = false;
        const expectedPath = '/' + request.entry.split('/').map(encodeURIComponent).join('/');
        for (let i = 0; i < 100; i++) { if (await evaluate(`location.pathname === ${JSON.stringify(expectedPath)} && document.readyState === 'complete'`)) { ready = true; break; } await delay(100); }
        if (!ready) throw new Error('发布页面加载超时');
        await evaluate(`(async()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager');await Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise((_,r)=>setTimeout(()=>r(Error('图片或字体加载超时')),10000))]);const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';document.head.append(s);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
        await delay(200);
        if (failed.size) throw new Error('发布页面有资源加载失败，请重新完整发布后重试');
        loadedEntry = request.entry;
        }
        const boundsExpression = `(()=>{const marker=${JSON.stringify(request.marker)};const matches=[...document.querySelectorAll('[data-label],[data-prd-id]')].filter(e=>e.getAttribute('data-prd-id')===marker||[...String(e.getAttribute('data-label')||'').matchAll(/\\[prd:([^\\]]+)\\]/g)].some(m=>m[1]===marker));if(matches.length!==1)throw Error('标记缺失或重复：'+marker+'（'+matches.length+'处）');const target=matches[0];const rects=[];for(const e of [target,...target.querySelectorAll('*')]){let visible=true;for(let a=e;a;a=a.parentElement){const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0){visible=false;break;}}if(!visible)continue;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;let left=r.left,top=r.top,right=r.right,bottom=r.bottom;for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a),b=a.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|scroll|auto/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}if(right>left&&bottom>top)rects.push({left,top,right,bottom});}if(!rects.length)throw Error('目标区域不可见；请在发布原型中展开相应面板状态');if([...target.querySelectorAll('img')].some(i=>!i.complete||!i.naturalWidth))throw Error('目标区域有图片未加载');const x=Math.max(0,Math.floor(Math.min(...rects.map(r=>r.left))+scrollX)),y=Math.max(0,Math.floor(Math.min(...rects.map(r=>r.top))+scrollY));const width=Math.ceil(Math.max(...rects.map(r=>r.right))+scrollX)-x,height=Math.ceil(Math.max(...rects.map(r=>r.bottom))+scrollY)-y;if(width<=0||height<=0||width>20000||height>20000||width*height>40000000)throw Error('截图范围无效或过大');return {x,y,width,height};})()`;
        const first = await evaluate(boundsExpression); await delay(200); const bounds = await evaluate(boundsExpression);
        if (JSON.stringify(first) !== JSON.stringify(bounds)) throw new Error('页面布局仍在变化，请稍后重试');
        const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...bounds, scale: 1 }, captureBeyondViewport: true, fromSurface: true });
        const png = Buffer.from(shot.data, 'base64');
        if (png.length > 20 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('截图生成失败或超过 20MB');
        if (capturedBytes + png.length > 100 * 1024 * 1024) throw new Error('本批截图超过 100MB，请分批生成');
        capturedBytes += png.length;
        results.push({ key: request.key, png });
      } catch (error) { results.push({ key: request.key, error: error instanceof Error ? error.message.slice(0, 400) : '截图失败' }); }
    }
    return results;
  } finally {
    ws?.close();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('截图任务已结束')); } pending.clear();
    if (browser?.pid && browser.exitCode === null) {
      browser.kill();
      await Promise.race([new Promise(resolve => browser!.once('exit', resolve)), delay(3000)]);
      if (browser.exitCode === null) { browser.kill('SIGKILL'); await Promise.race([new Promise(resolve => browser!.once('exit', resolve)), delay(1000)]); }
    }
    server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
