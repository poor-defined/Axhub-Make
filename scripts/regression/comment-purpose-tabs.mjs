import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated, synthetic fixture: no real project, AI execution, clipboard or user's browser profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const annotationEntry = createRequire(path.join(root, 'client/package.json')).resolve('@axhub/annotation');
const { build } = require(createRequire(require.resolve('tsx/package.json')).resolve('esbuild'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-purpose-tabs-'));
const profile = path.join(work, 'browser');
fs.mkdirSync(profile);
const browserCandidates = [process.env.AXHUB_CHROME_BIN];
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
if (fs.existsSync(cache)) {
  for (const name of fs.readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).reverse()) {
    browserCandidates.push(path.join(cache, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'));
  }
}
browserCandidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const executable = browserCandidates.find(value => value && fs.existsSync(value));
if (!executable) throw new Error('Set AXHUB_CHROME_BIN to an installed Chromium executable');
let browser;
let server;
let childServer;
let hostHtml = '';
let ws;
try {
  const source = `
import React from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
import { createCommentary } from ${JSON.stringify(path.join(root, 'vendor/axhub-commentary/src/core/editor/index.ts'))};
import { PageSkeleton } from ${JSON.stringify(path.join(root, 'src/components/ui/page-skeleton.tsx'))};
import { createAnnotationViewer } from ${JSON.stringify(annotationEntry)};
import { getPageZoomView } from ${JSON.stringify(path.join(root, 'vendor/axhub-commentary/src/utils/page-zoom-toggle.ts'))};
const read = () => JSON.parse(localStorage.getItem('fixture-comments') || 'null');
if (!localStorage.getItem('fixture-initialized')) {
  localStorage.setItem('fixture-initialized', '1');
  localStorage.setItem('fixture-comments', JSON.stringify({ schemaVersion:3, kind:'prototype-edit-comments',
    resource:{id:'fixture',targetPath:'prototypes/fixture',filePath:'src/prototypes/fixture/index.tsx'},
    comments:[{id:'legacy-fixture',elementKey:'legacy',locator:{selectors:['#fixture-component'],fingerprint:'button',path:[]},state:'idle',comment:'obsolete component annotation'}],images:[] }));
}
window.actions = []; window.failSave = false; window.pageClicks = 0;
document.getElementById('fixture-component').addEventListener('click',()=>{window.pageClicks++;});
window.editor = createCommentary({ interactionProfile: 'design', agentBridge: { enabled: false },
  host: { transformPrompt: prompt => 'fixture-project-policy\\n' + prompt, getPersistenceScope: () => ({ targetPath: 'prototypes/fixture', storageScope: 'purpose-fixture', prototypeId: 'fixture', filePath: 'src/prototypes/fixture/index.tsx', resource: null }),
    persistenceAdapter: { read: async () => read(), write: async (_scope, doc) => { if(window.saveDelay) await new Promise(resolve=>setTimeout(resolve,window.saveDelay)); if (window.failSave) throw Error('fixture save failed'); localStorage.setItem('fixture-comments', JSON.stringify(doc)); } } },
  ui: { initialSelectionModeActive: true, initialDarkMode: false, enableImageAttachments: true,
    commentListDockOrigin: new URL(location.href).searchParams.get('hostOrigin') || undefined,
    commentListLoadingContent: React.createElement(PageSkeleton, {variant:'list',label:'正在加载批注'}),
    onHostToolbarAction: async action => { window.actions.push(action); return true; },
    onGenerateComponentStates: async request => { window.actions.push({type:'generate',request}); return true; },
    onDocumentComponent: async capture => { window.actions.push({type:'document',capture}); return true; },
    onPrepareAxureExport: async payload => { window.actions.push({type:'export',payload}); return true; },
  },
});
window.nativeViewer = createAnnotationViewer({ source: { data: { version:2,prototypeName:'fixture',pageId:'fixture',nodes:[],updatedAt:1 },
  directory: { nodes:[{type:'route',id:'fixture-route',title:'订单页面',route:'/'}] },
  documents: { nodes:[{type:'markdown',id:'fixture-doc',title:'新文档',markdown:'# 组件说明'}] } }, options:{ emptyWhenNoData:true, toolbarAutoHide:false, showBrandLink:false } });
window.nativeViewer.start().then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
  // Match the host integration: native chrome mounts first, then commentary.
  // Establish a real page transform after the native package's startup effects.
  document.body.style.transform = 'translateY(4px)';
  window.originalPageTransform = document.body.style.transform;
  window.editor.start(); window.nativeReady = true; window.ready = true;
})));
window.openComposer = () => window.editor.openCommentTarget(document.querySelector('#fixture-component'));
window.readComments = read;
window.readCanvasView = getPageZoomView;
`;
  fs.writeFileSync(path.join(work, 'fixture.tsx'), source);
  await build({ absWorkingDir: root, entryPoints: [path.join(work, 'fixture.tsx')], outfile: path.join(work, 'app.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
    tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>组件批注回归</title>
<style>body{margin:0;padding:32px;background:#f5f6f8;font:14px system-ui}main{max-width:640px;margin:120px 0;background:white;border:1px solid #ddd;border-radius:16px;padding:24px}h1{font-size:24px}button{font:inherit}#fixture-component{background:#008f5d;color:white;border:0;border-radius:8px;padding:12px 24px}</style>
<body style="transform:translateY(4px)"><main><h1>订单操作</h1><p>用于验证组件批注的隔离页面</p><button id="fixture-component" aria-label="提交订单">提交订单</button></main><script src="/app.js"></script></body></html>`;
  server = createServer((request, response) => {
    if (request.url === '/host.html') { response.setHeader('content-type','text/html; charset=utf-8'); response.end(hostHtml); return; }
    if (request.url === '/host.js') { response.setHeader('content-type','text/javascript; charset=utf-8'); response.end(fs.readFileSync(path.join(work,'host.js'))); return; }
    response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(request.url === '/app.js' ? fs.readFileSync(path.join(work, 'app.js')) : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless', '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
  assert(fs.existsSync(portFile), 'isolated Chromium starts');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  const pending = new Map(); let id = 0; const errors = []; const contexts = new Map();
  ws.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.method === 'Runtime.executionContextCreated' && value.params.context.auxData?.isDefault) contexts.set(value.params.context.auxData.frameId, value.params.context.id);
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
    if (value.id) { const task = pending.get(value.id); pending.delete(value.id); value.error ? task.reject(Error(JSON.stringify(value.error))) : task.resolve(value.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression, contextId) => {
    const response = await call('Runtime.evaluate', { expression, ...(contextId ? {contextId} : {}), returnByValue: true, awaitPromise: true }).catch(error => { throw new Error(`Evaluate failed: ${expression}`, { cause: error }); });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 80; i++) { const value = await evaluate(expression); if (value) return value; await delay(100); }
    throw Error(`Timeout: ${expression}`);
  };
  // Traverse the real editor's shadow root; all interaction uses native browser input.
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin }); await wait('window.ready');
  await wait(`Boolean(window.nativeReady && document.getElementById('__axhub_annotation_host__')?.shadowRoot?.querySelector('.axhub-annotation-edge-toolbar'))`);
  await evaluate('window.openComposer()');
  // Host name is a runtime constant, so discover it instead of relying on an implementation-specific id.
  await wait(`Boolean(window.editorRoot = [...document.querySelectorAll('*')].find(element => element.shadowRoot?.querySelector('.we-purpose-composer'))?.shadowRoot)`);
  await wait(`window.editorRoot?.querySelectorAll('[role="tab"]').length === 3`);
  await wait('window.nativeReady');
  await wait(`Boolean(window.nativeRoot = document.getElementById('__axhub_annotation_host__')?.shadowRoot)`);
  await wait(`window.readComments()?.comments.length === 0`);
  const find = (selector, owner = 'window.editorRoot') => `${owner}.querySelector(${JSON.stringify(selector)})`;
  const click = async (selector, owner) => {
    const box = await wait(`(()=>{const element=${find(selector, owner)};if(!element||element.disabled||getComputedStyle(element).visibility==='hidden')return null;element.scrollIntoView({block:'center',inline:'nearest'});const rect=element.getBoundingClientRect();const x=rect.x+rect.width/2,y=rect.y+rect.height/2;const hit=element.getRootNode().elementFromPoint(x,y);return rect.width&&rect.height&&(hit===element||element.contains(hit))?{x,y}:null})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, ...box, button: 'left', clickCount: 1 });
    await delay(70);
  };
  const type = async text => { await click('[aria-label="给 AI 的指示"]'); await call('Input.insertText', { text }); await delay(70); };
  const inputValue = () => evaluate(`${find('[aria-label="给 AI 的指示"]')}.value`);
  const tab = label => click(`[role="tab"][aria-label="${label}"]`);
  const save = () => click('[aria-label="暂存批注"]');
  await type('修改 A'); await tab('生成新原型'); await type('生成 B'); await tab('引入说明'); await type('说明 C');
  await tab('修改原型'); assert.equal(await inputValue(), '修改 A'); await save();
  await wait(`window.readComments()?.comments.length===1`);
  assert.equal(await inputValue(), ''); await type('修改 D'); await save();
  await wait(`window.readComments()?.comments.length===2`);
  assert.deepEqual(await evaluate(`window.readComments().comments.map(entry=>entry.comment)`), ['修改 A', '修改 D']);
  await tab('生成新原型'); assert.equal(await inputValue(), '生成 B'); await save();
  await tab('引入说明'); assert.equal(await inputValue(), '说明 C'); await save();
  await wait(`window.readComments()?.comments.length===4`);
  await click('[aria-label="关闭组件批注"]'); await evaluate('window.openComposer()');
  await wait(`Boolean(${find('[aria-label="给 AI 的指示"]')})`); await type('失败时保留');
  await evaluate('window.failSave=true'); await save();
  await wait(`${find('.we-purpose-composer [role="alert"]')}?.textContent.includes('fixture save failed')`);
  assert.equal(await inputValue(), '失败时保留');
  await evaluate('window.failSave=false'); await save();
  await wait(`window.readComments()?.comments.length===5`);
  await delay(600);
  assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item').length`), 5);
  // A matching record-scoped send carries both same-component IDs and both instructions.
  await click('.we-comment-list__item:nth-child(1) input[type="checkbox"]');
  await click('.we-comment-list__item:nth-child(2) input[type="checkbox"]');
  await click('[aria-label="发送所选批注"]');
  const sent = await wait(`window.actions.find(action=>action.type==='send-to-agent')`);
  assert.equal(sent.targets.length, 2); assert.notEqual(sent.targets[0].commentId, sent.targets[1].commentId);
  assert(sent.promptText.includes('修改 A') && sent.promptText.includes('修改 D'));
  assert(sent.promptText.startsWith('fixture-project-policy\n'), 'host policy applies to explicit records');
  const sameKey = sent.targets[0].elementKey;
  await evaluate(`window.editor.setNodeEditingState(${JSON.stringify(sameKey)},'editing',{provider:'fixture',requestId:'run-1',sessionId:'s'},{commentId:${JSON.stringify(sent.targets[0].commentId)}})`);
  assert.equal(await evaluate(`window.readComments().comments.find(entry=>entry.id===${JSON.stringify(sent.targets[0].commentId)}).state`), 'editing');
  assert.equal(await evaluate(`window.readComments().comments.find(entry=>entry.id===${JSON.stringify(sent.targets[1].commentId)}).state`), 'idle');
  await evaluate(`window.editor.setNodeEditingState(${JSON.stringify(sameKey)},'completed',{provider:'fixture',requestId:'run-1',sessionId:'s'},{commentId:${JSON.stringify(sent.targets[0].commentId)}})`);
  await evaluate('window.openComposer()'); await delay(300);
  await type('继续添加');
  const outDir = process.env.COMMENT_PURPOSE_SCREENSHOTS || work;
  fs.mkdirSync(outDir, { recursive: true });
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'));
  };
  await screenshot('comment-purpose-desktop.png');
  const originalMatrix = await evaluate('getComputedStyle(document.body).transform');
  await click('[aria-label="固定批注列表到右侧"]');
  await wait(`${find('.we-comment-list')}?.dataset.pinned==='true' && document.body.style.transform.includes('scale(')`);
  const dock = await evaluate(`(()=>{const r=${find('.we-comment-list')}.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,bodyRight:document.body.getBoundingClientRect().right}})()`);
  assert.equal(dock.top, 0); assert.equal(dock.bottom, 1000); assert.equal(dock.right, 1440, 'pinned list touches the right edge');
  assert(dock.bodyRight <= 1440-372+1, 'pin reserves actual canvas width');
  assert(await evaluate(`window.nativeRoot.querySelector('.axhub-annotation-edge-toolbar').getBoundingClientRect().right<=1440-320`), 'native toolbar stays beside the list');
  await screenshot('comment-list-pinned.png');
  await click('[aria-label="关闭批注列表"]');
  await wait(`getComputedStyle(document.body).transform===${JSON.stringify(originalMatrix)}`);
  await click('[aria-label="批注列表"]', 'window.nativeRoot');
  await wait(`!${find('.we-comment-list')}.hidden && document.body.style.transform.includes('scale(')`);
  assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item input:checked').length`), 2, 'close and reopen preserves selection');
  for (const label of ['文档目录', '页面目录']) {
    await click(`[aria-label="${label}"]`, 'window.nativeRoot');
    await wait(`${find('.we-comment-list')}.hidden`);
    await wait(`${find(`[aria-label="${label}"]`, 'window.nativeRoot')}.getAttribute('aria-pressed')==='true'`);
    await screenshot(`comment-list-native-${label==='文档目录'?'documents':'pages'}.png`);
    await click('[aria-label="批注列表"]', 'window.nativeRoot');
    await wait(`!${find('.we-comment-list')}.hidden && ${find(`[aria-label="${label}"]`, 'window.nativeRoot')}.getAttribute('aria-pressed')!=='true'`);
    await wait(`document.body.getBoundingClientRect().right<=1440-372+1`);
    assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item input:checked').length`), 2);
  }
  await click('[aria-label="取消固定批注列表"]');
  await wait(`getComputedStyle(document.body).transform===${JSON.stringify(originalMatrix)}`);
  await click('[aria-label="固定批注列表到右侧"]');
  await wait(`document.body.style.transform.includes('scale(')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await delay(400);
  assert.equal(await evaluate('getComputedStyle(document.body).transform'), originalMatrix, 'narrow screens release the canvas reservation');
  assert(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'no page overflow on narrow screens');
  const bounds = await evaluate(`(()=>{const rect=${find('.we-purpose-composer')}.getBoundingClientRect();return {left:rect.left,right:rect.right,bottom:rect.bottom}})()`);
  assert(bounds.left >= 0 && bounds.right <= 390 && bounds.bottom <= 844, 'composer fits the narrow viewport');
  const listBottom = await evaluate(`${find('.we-comment-list')}.getBoundingClientRect().bottom`);
  const composerTop = await evaluate(`${find('.we-purpose-composer')}.getBoundingClientRect().top`);
  assert(listBottom <= composerTop, 'list and composer do not overlap on a narrow screen');
  await screenshot('comment-purpose-mobile.png');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`window.editor.runHostToolbarAction({type:'toggle-dark-mode',darkMode:true})`); await delay(200);
  await screenshot('comment-purpose-dark.png');
  await call('Page.reload'); await wait('window.ready'); await evaluate('window.openComposer()'); await delay(600);
  await evaluate(`Boolean(window.editorRoot = [...document.querySelectorAll('*')].find(element => element.shadowRoot?.querySelector('.we-purpose-composer'))?.shadowRoot)`);
  await wait(`Boolean(window.nativeRoot=document.getElementById('__axhub_annotation_host__')?.shadowRoot)`);
  await wait(`Boolean(${find('[aria-label="取消固定批注列表"]')})`);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait(`document.body.style.transform.includes('scale(')`);
  assert.equal(await evaluate(`${find('.we-comment-list')}.dataset.pinned`), 'true', 'pin preference survives reload');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await delay(400);
  assert.equal(await evaluate(`window.readComments().comments.length`), 5);
  assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item').length`), 5);
  await click('.we-comment-list__item:nth-child(2) button[aria-label^="编辑批注"]');
  assert.equal(await inputValue(), '修改 D');
  await type('（已编辑）'); await save();
  assert.equal(await evaluate('window.readComments().comments.length'), 5, 'editing does not create a duplicate');
  await click('.we-comment-list__item:nth-child(3) input[type="checkbox"]');
  await click('[aria-label="发送所选批注"]');
  const generated = await wait(`window.actions.find(action=>action.type==='generate')`);
  assert(generated.request.capture.note.includes('生成 B'));
  assert(generated.request.capture.imageDataUrl.startsWith('data:image/png;base64,'));
  await click('.we-comment-list__item:nth-child(3) input[type="checkbox"]');
  await click('.we-comment-list__item:nth-child(4) input[type="checkbox"]');
  await click('[aria-label="发送所选批注"]');
  const documented = await wait(`window.actions.find(action=>action.type==='document')`);
  assert(documented.capture.note.includes('说明 C'));
  await click('.we-comment-list__item:nth-child(5) button[aria-label^="删除批注"]');
  assert.equal(await evaluate('window.readComments().comments.filter(entry=>!entry.deletedAt).length'), 4);
  // Mixed-purpose deletion is independent of send grouping, and failures keep the full selection.
  if (!await evaluate(`${find('[aria-label="全选批注"]')}.checked`)) await click('[aria-label="全选批注"]');
  await click('[aria-label="全选批注"]');
  await click('.we-comment-list__item:nth-child(1) input[type="checkbox"]');
  await click('.we-comment-list__item:nth-child(3) input[type="checkbox"]');
  assert.equal(await evaluate(`${find('[aria-label="发送所选批注"]')}.disabled`), true);
  await click('[aria-label="删除所选批注"]'); await click('[aria-label="取消删除批注"]');
  assert.equal(await evaluate('window.readComments().comments.filter(entry=>!entry.deletedAt).length'), 4);
  await click('[aria-label="删除所选批注"]');
  await evaluate('window.failSave=true'); await click('[aria-label="确认删除批注"]');
  await wait(`${find('.we-comment-list [role="alert"]')}?.textContent.includes('fixture save failed')`);
  await delay(650);
  assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item input:checked').length`), 2, 'failed deletion preserves selection after polling');
  assert.equal(await evaluate(`window.editorRoot.querySelectorAll('.we-comment-list__item').length`), 4, 'failed deletion restores all visible records');
  await evaluate('window.failSave=false'); await click('[aria-label="确认删除批注"]');
  await wait(`window.readComments().comments.filter(entry=>!entry.deletedAt).length===2`);
  assert.deepEqual(await evaluate(`window.readComments().comments.filter(entry=>!entry.deletedAt).map(entry=>entry.comment)`), ['修改 D（已编辑）', '说明 C']);
  await call('Page.reload'); await wait('window.ready'); await evaluate('window.openComposer()'); await delay(650);
  await wait(`Boolean(window.editorRoot=[...document.querySelectorAll('*')].find(element=>element.shadowRoot?.querySelector('.we-purpose-composer'))?.shadowRoot)`);
  await wait(`window.editorRoot.querySelectorAll('.we-comment-list__item').length===2`);
  // Exercise the actual canvas controls through native browser input.
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(400);
  await wait(`Boolean(window.nativeRoot=document.getElementById('__axhub_annotation_host__')?.shadowRoot)`);
  const scale = () => evaluate('new DOMMatrix(getComputedStyle(document.body).transform).a');
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await call('Input.dispatchKeyEvent', { type:'keyDown', key, code, windowsVirtualKeyCode, modifiers });
    await call('Input.dispatchKeyEvent', { type:'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  };
  // Text editing must not activate canvas shortcuts.
  await click('[aria-label="给 AI 的指示"]'); const editingScale = await scale();
  await key('+', 'Equal', 187, 2); assert.equal(await scale(), editingScale);
  await click('[aria-label="关闭组件批注"]');
  await wait(`Boolean(${find('[aria-label="画布缩放比例"]')})`);
  const fitScale = await scale();
  await click('[aria-label="放大画布"]'); assert(Math.abs(await scale() - (fitScale + 0.1)) < 0.006);
  await click('[aria-label="缩小画布"]'); assert(Math.abs(await scale() - fitScale) < 0.006);
  // Headless macOS does not expose the OS select popup to CDP keyboard input;
  // select the standard DOM option, then exercise the real React change handler.
  await evaluate(`(()=>{const select=${find('[aria-label="画布缩放比例"]')};select.value='150';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait('Math.abs(new DOMMatrix(getComputedStyle(document.body).transform).a-1.5)<0.001');
  assert.equal(await evaluate(`${find('.we-comment-list')}.getBoundingClientRect().width`), 320, 'zoom never scales editor chrome');
  await screenshot('preview-canvas-150-percent.png');
  await click('[aria-label="重置画布视图"]'); assert.equal(await scale(), 1);
  const rect = () => evaluate(`(()=>{const r=document.querySelector('main').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  const beforeWheel = await rect();
  await call('Input.dispatchMouseEvent', {type:'mouseWheel',x:700,y:650,deltaX:0,deltaY:-120,modifiers:2});
  await wait('new DOMMatrix(getComputedStyle(document.body).transform).a>1.2');
  const afterWheel = await rect(), wheelScale = await scale();
  assert(Math.abs(afterWheel.left-(700+(beforeWheel.left-700)*wheelScale))<1, 'wheel zoom preserves pointer content X');
  assert(Math.abs(afterWheel.top-(650+(beforeWheel.top-650)*wheelScale))<1, 'wheel zoom preserves pointer content Y');
  const drag = async (dx,dy,x=700,y=650) => {
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'left',buttons:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1});
    await delay(100);
  };
  await click('[aria-label="拖动画布"]'); const beforeDrag = await rect(); await drag(50,40); const afterDrag = await rect();
  assert(Math.abs(afterDrag.left-beforeDrag.left-50)<1 && Math.abs(afterDrag.top-beforeDrag.top-40)<1, 'drag mode moves the actual page');
  await click('[aria-label="重置画布视图"]');
  const pageButton = await evaluate(`(()=>{const r=document.getElementById('fixture-component').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const clicksBeforeDrag = await evaluate('window.pageClicks');
  await drag(10,5,pageButton.x,pageButton.y);
  assert.equal(await evaluate('window.pageClicks'), clicksBeforeDrag, 'dragging from a page button never activates it');
  await click('[aria-label="拖动画布"]');
  await evaluate(`window.editorRoot.activeElement?.blur();document.activeElement?.blur()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  const beforeSpace = await rect(); await drag(40,20); const afterSpace = await rect();
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  assert(Math.abs(afterSpace.left-beforeSpace.left-40)<1 && Math.abs(afterSpace.top-beforeSpace.top-20)<1, 'space drag moves the actual page');
  await key('0','Digit0',48,2); assert.equal(await scale(), 1);
  await key('!','Digit1',49,8); await delay(100); assert(Math.abs(await scale()-fitScale)<0.006);
  await click('[aria-label="放大画布"]'); const savedScale = await scale();
  await click('[aria-label="文档目录"]','window.nativeRoot');
  await wait(`!${find('[aria-label="画布缩放比例"]')}`);
  await click('[aria-label="文档目录"]','window.nativeRoot');
  await wait(`Boolean(${find('[aria-label="画布缩放比例"]')}) && Math.abs(new DOMMatrix(getComputedStyle(document.body).transform).a-${savedScale})<0.001`);
  await evaluate(`(()=>{const button=document.createElement('button');button.setAttribute('data-fixture-native-action','true');button.textContent='Action';window.nativeRoot.querySelector('.axhub-annotation-edge-toolbar').append(button);})()`);
  await delay(100); await click('[data-fixture-native-action]','window.nativeRoot');
  await wait(`Boolean(${find('[aria-label="画布缩放比例"]')}) && Math.abs(new DOMMatrix(getComputedStyle(document.body).transform).a-${savedScale})<0.001`);
  await evaluate(`window.nativeRoot.querySelector('[data-fixture-native-action]').remove()`);
  await click('[aria-label="快捷键"]','window.nativeRoot');
  await wait(`Boolean(${find('.we-runtime-keyboard-shortcuts-modal .ant-modal-close')})`);
  await wait(`${find('.we-runtime-keyboard-shortcuts-modal')}.getAnimations({subtree:true}).every(animation=>animation.playState!=='running')`);
  await click('.we-runtime-keyboard-shortcuts-modal .ant-modal-close');
  await wait(`Boolean(${find('[aria-label="画布缩放比例"]')}) && Math.abs(new DOMMatrix(getComputedStyle(document.body).transform).a-${savedScale})<0.001`);
  await click('[aria-label="放大画布"]');
  assert(Math.abs(await scale()-(savedScale+0.1))<0.006, 'non-panel shortcut actions reacquire the canvas');
  await click('[aria-label="拖动画布"]'); await drag(20,30); await click('[aria-label="拖动画布"]');
  await evaluate(`history.pushState({},'', '/second-page');window.dispatchEvent(new PopStateEvent('popstate'))`);
  await wait(`window.readCanvasView().mode==='fit' && window.readCanvasView().panX===0 && window.readCanvasView().panY===0`);
  await evaluate('window.editor.stop()');
  await wait('document.body.style.transform===window.originalPageTransform');

  // The actual workspace component must dock outside a centered cross-origin iframe.
  childServer = createServer((request,response)=>{
    response.setHeader('content-type',request.url==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    response.end(request.url==='/app.js'?fs.readFileSync(path.join(work,'app.js')):html);
  });
  await new Promise(resolve=>childServer.listen(0,'127.0.0.1',resolve));
  const childOrigin=`http://127.0.0.1:${childServer.address().port}`;
  const hostSource = `
import React from ${JSON.stringify(path.join(root,'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(root,'node_modules/react-dom/client.js'))};
import {CommentListWorkspace} from ${JSON.stringify(path.join(root,'src/index/components/content/CommentListWorkspace.tsx'))};
import {PreviewIframe} from ${JSON.stringify(path.join(root,'src/components/ui/preview-iframe.tsx'))};
function App(){const frame=React.useRef(null);const area=React.useRef(null);const[width,setWidth]=React.useState(2000);
 React.useEffect(()=>{const observer=new ResizeObserver(()=>setWidth(area.current.clientWidth));observer.observe(area.current);return()=>observer.disconnect();},[]);
 const scale=Math.min(1,(width-32)/1440);
 return <div style={{height:'100vh',background:'#f4f5f6',fontFamily:'system-ui'}}><header style={{height:60,padding:'0 24px',display:'flex',alignItems:'center',borderBottom:'1px solid #ddd',background:'white'}}>真实宿主工作区 · 自定义 1440px 预览</header><div style={{height:'calc(100vh - 60px)'}}>
 <CommentListWorkspace frameRef={frame} resourceKey="host-fixture" active>{docked=><div ref={area} data-host-preview-area style={{height:'100%',width:docked?'calc(100% - 320px)':'100%',display:'flex',justifyContent:'center',paddingTop:16,boxSizing:'border-box'}}>
 <div style={{width:1440*scale,height:900*scale,overflow:'hidden',border:'1px solid #ddd',flexShrink:0}}>
 <PreviewIframe ref={node=>{frame.current=node;window.frameForTest=node;}} src=${JSON.stringify(`${childOrigin}/?hostOrigin=${encodeURIComponent(origin)}`)} title="居中跨源原型" style={{width:1440,height:900,transform:'scale('+scale+')',transformOrigin:'top left'}} onLoad={()=>{window.hostLoads=(window.hostLoads||0)+1;}} />
 </div></div>}</CommentListWorkspace></div></div>;}
 createRoot(document.getElementById('root')).render(<App/>);`;
  fs.writeFileSync(path.join(work,'host.tsx'),hostSource);
  await build({absWorkingDir:root,entryPoints:[path.join(work,'host.tsx')],outfile:path.join(work,'host.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'});
  hostHtml='<!doctype html><html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;width:100%}*{box-sizing:border-box}</style><body><div id="root"></div><script src="/host.js"></script></body></html>';
  await call('Emulation.setDeviceMetricsOverride',{width:2048,height:1220,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/host.html`}); await wait('window.hostLoads===1');
  const frameTree=await call('Page.getFrameTree');const frameId=frameTree.frameTree.childFrames[0].frame.id;
  let contextId=contexts.get(frameId);assert(contextId,'child execution context exists');
  const frameEval=expression=>evaluate(expression,contextId);
  const frameWait=async expression=>{for(let i=0;i<80;i++){const value=await frameEval(expression);if(value)return value;await delay(100);}throw Error('Frame timeout: '+expression);};
  await frameWait('window.ready');await frameEval('window.openComposer()');
  await frameWait(`Boolean(window.editorRoot=document.getElementById('__mcp_web_editor_v2_host__')?.shadowRoot)`);
  await frameEval(`window.nativeRoot=document.getElementById('__axhub_annotation_host__').shadowRoot`);
  const frameClick=async(selector,owner='window.editorRoot')=>{
    const box=await frameWait(`(()=>{const e=${owner}.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth}:null;})()`);
    const outer=await evaluate(`(()=>{const r=window.frameForTest.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width}})()`);
    const point={x:outer.x+box.x*outer.width/box.width,y:outer.y+box.y*outer.width/box.width};
    for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await delay(100);
  };
  await frameClick('[aria-label="给 AI 的指示"]');await call('Input.insertText',{text:'真正宿主上的批注'});await frameClick('[aria-label="暂存批注"]');
  await frameWait('window.readComments().comments.filter(e=>!e.deletedAt).length===1');
  await frameClick('[role="tab"][aria-label="生成新原型"]');await frameClick('[aria-label="给 AI 的指示"]');await call('Input.insertText',{text:'宿主编辑生成用途'});await frameClick('[aria-label="暂存批注"]');
  await frameWait('window.readComments().comments.filter(e=>!e.deletedAt).length===2');
  await frameClick('[role="tab"][aria-label="修改原型"]');
  await frameClick('[aria-label="给 AI 的指示"]');await call('Input.insertText',{text:'切换固定保留的草稿'});
  await evaluate('Boolean(window.originalIframe=window.frameForTest)');
  await frameClick('[aria-label="固定批注列表到右侧"]');
  await wait(`Boolean(document.querySelector('[data-hosted-comment-list]:not([hidden]) .we-comment-list__item'))`);
  const hostBounds=await evaluate(`(()=>{const r=document.querySelector('[data-hosted-comment-list]').getBoundingClientRect(),f=window.frameForTest.getBoundingClientRect();return{right:r.right,frameRight:f.right,left:r.left,loads:window.hostLoads,same:window.originalIframe===window.frameForTest}})()`);
  assert.equal(hostBounds.right,2048,'dock reaches the host workspace edge');assert(hostBounds.right>hostBounds.frameRight+50,'dock is outside the centered iframe');assert.equal(hostBounds.loads,1);assert.equal(hostBounds.same,true);
  assert.equal(await frameEval(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').value`),'切换固定保留的草稿');
  await frameWait('window.readCanvasView().reservedRightWidth===0');
  await screenshot('comment-list-host-workspace.png');
  await click('.we-comment-list__item:nth-child(2) button[aria-label^="编辑批注"]','document');
  await frameWait(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').value==='宿主编辑生成用途'`);
  await frameClick('[role="tab"][aria-label="修改原型"]');
  assert.equal(await frameEval(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').value`),'切换固定保留的草稿');
  await click('.we-comment-list__item:nth-child(1) .we-comment-list__locate','document');
  await click('.we-comment-list__item input[type="checkbox"]','document');await delay(600);
  await click('[aria-label="发送所选批注"]','document');
  await frameWait(`window.actions.some(action=>action.type==='send-to-agent'&&action.promptText.includes('真正宿主上的批注'))`);
  await click('.we-comment-list__item:nth-child(2) input[type="checkbox"]','document');await delay(600);
  await frameEval('window.saveDelay=900;window.failSave=true');
  await click('[aria-label="删除所选批注"]','document');await click('[aria-label="确认删除批注"]','document');
  await wait(`document.querySelector('.we-comment-list [role="alert"]')?.textContent.includes('fixture save failed')`);
  assert.equal(await evaluate(`document.querySelector('.we-comment-list__item input').checked`),true,'slow remote deletion failure preserves host selection');
  await frameEval('window.saveDelay=0;window.failSave=false');await click('[aria-label="确认删除批注"]','document');
  await wait(`document.querySelectorAll('.we-comment-list__item').length===0`);
  await frameEval(`window.editor.runHostToolbarAction({type:'toggle-dark-mode',darkMode:true})`);await delay(600);
  await wait(`getComputedStyle(document.querySelector('.we-comment-list')).backgroundColor==='rgb(18, 18, 18)'`);
  await screenshot('comment-list-host-dark.png');
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});await delay(400);
  assert.equal(await evaluate(`document.querySelector('[data-hosted-comment-list]').getBoundingClientRect().right`),1500);
  assert.equal(await frameEval('innerWidth'),1440,'device logical width is preserved');
  await click('[aria-label="取消固定批注列表"]','document');await wait(`document.querySelector('[data-hosted-comment-list]')?.hidden`);
  await frameWait(`!window.editorRoot.querySelector('.we-comment-list').hidden`);
  assert.equal(await evaluate('window.hostLoads'),1,'dock and undock do not reload the iframe');
  assert.equal(await frameEval(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').value`),'切换固定保留的草稿');
  await frameClick('[aria-label="固定批注列表到右侧"]');await wait(`!document.querySelector('[data-hosted-comment-list]').hidden`);
  // Empty annotations are real purpose records, and refresh must retain them.
  const actionCount = await frameEval('window.actions.length');
  let emptyCount = 0;
  for (const purpose of ['修改原型','生成新原型','引入说明']) {
    await frameClick(`[role="tab"][aria-label="${purpose}"]`);
    if (await frameEval(`Boolean(window.editorRoot.querySelector('[aria-label="新增批注"]'))`)) await frameClick('[aria-label="新增批注"]');
    await frameClick('[aria-label="给 AI 的指示"]');
    await frameEval(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').select()`); await key('Backspace','Backspace',8);
    await frameWait(`window.editorRoot.querySelector('[aria-label="给 AI 的指示"]').value===''`);
    assert.equal(await frameEval(`window.editorRoot.querySelector('[aria-label="暂存批注"]').disabled`),false);
    assert.equal(await frameEval(`window.editorRoot.querySelector('[aria-label="发送"]').disabled`),true);
    await frameClick('[aria-label="暂存批注"]'); emptyCount++;
    await wait(`document.querySelectorAll('.we-comment-list__item').length===${emptyCount}`);
  }
  assert.equal(await frameEval('window.actions.length'),actionCount,'empty saves do not trigger AI');
  assert(await evaluate(`Array.from(document.querySelectorAll('.we-comment-list__note')).every(e=>e.textContent==='未填写指示')`));
  await call('Page.reload'); await wait('window.hostLoads===1');
  const reloadedTree = await call('Page.getFrameTree'); contextId = contexts.get(reloadedTree.frameTree.childFrames[0].frame.id);
  await frameWait('window.ready');
  await wait(`document.querySelectorAll('.we-comment-list__item').length===3`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.we-comment-list__note')).every(e=>e.textContent==='未填写指示')`),'blank annotations survive refresh');
  await frameEval('window.editor.stop()');await wait(`document.querySelector('[data-hosted-comment-list]')?.hidden`);
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log('PASS: actual host workspace dock outside a centered cross-origin 1440px iframe, no iframe reload/draft loss, slow deletion failure/retry, host dark theme and resizing; zoom/pan/shortcuts and original comment regressions.');
  if (process.env.COMMENT_PURPOSE_SCREENSHOTS) console.log(`Screenshots: ${outDir}`);
} finally {
  ws?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill('SIGTERM'); await exited;
  }
  if (server) await new Promise(resolve => server.close(resolve));
  if (childServer) await new Promise(resolve => childServer.close(resolve));
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
