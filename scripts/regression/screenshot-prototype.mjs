import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Disposable browser and synthetic generation only; never calls an AI or reads the system clipboard.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { build } = require(createRequire(require.resolve('tsx/package.json')).resolve('esbuild'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-prototype-'));
const profile = path.join(work, 'browser'); fs.mkdirSync(profile);
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const candidates = [process.env.AXHUB_CHROME_BIN];
if (fs.existsSync(cache)) for (const name of fs.readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).reverse()) candidates.push(path.join(cache, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'));
candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const executable = candidates.find(value => value && fs.existsSync(value));
if (!executable) throw new Error('Set AXHUB_CHROME_BIN to an installed Chromium executable');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kAAAAABJRU5ErkJggg==';
let browser, server, ws;
try {
  fs.writeFileSync(path.join(work, 'fixture.tsx'), `
import React, {useRef, useSyncExternalStore} from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
import {ScreenshotPrototypeComposer, ScreenshotPrototypeStartCard} from ${JSON.stringify(path.join(root, 'src/index/components/content/ScreenshotPrototypeComposer.tsx'))};
import {ThemeStartPromptGrid} from ${JSON.stringify(path.join(root, 'src/index/components/content/ThemeStartPromptGrid.tsx'))};
import {createScreenshotPrototypeSession} from ${JSON.stringify(path.join(root, 'src/index/domains/prototype-generation/screenshotPrototypeSession.ts'))};
import {FileIcon} from 'lucide-react';
window.prepares = []; window.runs = []; window.fail = true;
const session = createScreenshotPrototypeSession({
 prepare: async (request,project) => { window.prepares.push({request,project}); return {name:'fixture',displayName:request.title,prompt:'brief',filePath:'src/prototypes/fixture/index.tsx',clientUrl:'/?p=fixture'}; },
 run: async (prepared,request,project) => { window.runs.push({prepared,request,project}); await new Promise(resolve=>{window.finishRun=resolve}); if(window.fail) throw Error('模拟 AI 连接中断'); },
 onDone: () => {},
});
function App() {
 const ref = useRef(null), state = useSyncExternalStore(session.subscribe,session.getState);
 const controller = {state,generate:request=>session.generate('fixture-project',request),retry:session.retry,reset:session.reset,openPrototype:()=>{window.opened=true}};
 return <main className="mx-auto max-w-[960px] p-6"><h1 className="mb-8 text-center text-3xl font-semibold dark:text-slate-100">我们先从哪里开始呢？</h1>
 <ThemeStartPromptGrid cards={['根据 PRD 生成原型','根据设计图还原原型','参考 Axure 生成原型','根据流程图生成页面','生成 CRM 管理后台','运动记录 APP 首页','Apple 风格智能家居'].map((title,index)=>({id:String(index),title,prompt:title,icon:FileIcon}))} disabled={false} selectPrompt={()=>{}} onCopyPrompt={()=>{}} trailingCard={<ScreenshotPrototypeStartCard inputRef={ref}/>}/>
 <ScreenshotPrototypeComposer controller={controller} ref={ref}/></main>;
}
createRoot(document.getElementById('root')).render(<App/>); window.ready=true;
window.makeImage = () => new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))], 'home.png', {type:'image/png'});
`);
  await build({ absWorkingDir: root, entryPoints: [path.join(work, 'fixture.tsx')], outfile: path.join(work, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  const cssFiles = ['index2.css', 'index.css'].filter(name => fs.existsSync(path.join(root, 'dist/admin/assets', name)));
  assert(cssFiles.length === 2, 'run pnpm admin:build before this browser regression');
  const css = cssFiles.map(name => fs.readFileSync(path.join(root, 'dist/admin/assets', name), 'utf8')).join('\n');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>截图生成原型回归</title><link rel="stylesheet" href="/app.css"><body style="margin:0;background:#f7f9fb"><div id="root" class="ax-start-guide"></div><script src="/app.js"></script></body></html>`;
  server = createServer((req,res) => { res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8'); res.end(req.url==='/app.js'?fs.readFileSync(path.join(work,'app.js')):req.url==='/app.css'?css:html); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  browser = spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--headless','--no-first-run','--disable-background-networking','about:blank'],{stdio:'ignore'});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(portFile);i++) await delay(100);
  assert(fs.existsSync(portFile),'isolated Chromium starts');
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let id=0; const pending=new Map(), errors=[];
  ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.text);if(value.id){const task=pending.get(value.id);pending.delete(value.id);value.error?task.reject(Error(JSON.stringify(value.error))):task.resolve(value.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params}));});
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const wait=async expression=>{for(let i=0;i<80;i++){const result=await evaluate(expression);if(result)return result;await delay(80);}throw Error(`Timeout: ${expression}`);};
  const click=async selector=>{const box=await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...box,button:'left',clickCount:1});await delay(50);};
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`}); await wait('Boolean(window.ready && document.querySelector("textarea"))');
  assert.equal(await evaluate('document.querySelectorAll(".ax-start-prompt-grid > li").length'),8);
  await click('.ax-start-prompt-grid > li:last-child button');
  assert.equal(await evaluate('document.activeElement.id'),'screenshot-prototype-instructions');
  assert.equal(await evaluate('document.querySelector("[aria-label=生成截图原型]").disabled'),true);
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(window.makeImage());document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelectorAll(".ax-screenshot-composer img").length===1 && !document.querySelector("[aria-label=生成截图原型]").disabled');
  assert.equal(await evaluate('window.prepares.length'),0,'pasting alone does not create a resource');
  await call('Input.insertText',{text:'保留截图布局和中文导航'});
  await click('[aria-label="生成截图原型"]');
  await wait('window.runs.length===1');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-page-skeleton=preview]"))'),true);
  assert.equal(await evaluate('window.runs[0].request.images[0].dataUrl'),`data:image/png;base64,${png}`);
  assert.equal(await evaluate('window.runs[0].request.instructions'),'保留截图布局和中文导航');
  await evaluate('window.finishRun()'); await wait('document.querySelector("[role=alert]")?.textContent.includes("模拟 AI")');
  assert.equal(await evaluate('document.querySelectorAll("[data-page-skeleton]").length'),0);
  assert.equal(await evaluate('document.querySelectorAll(".ax-screenshot-composer img").length'),1);
  await evaluate('window.fail=false');
  await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='重试').click()`); await wait('window.runs.length===2');
  assert.equal(await evaluate('window.prepares.length'),1,'retry reuses the prepared resource');
  await evaluate('window.finishRun()'); await wait(`document.querySelector('.ax-screenshot-composer [role=status]')?.textContent.includes('已生成')`);
  await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='重新开始').click()`);
  await click('[aria-label="移除截图 1"]'); assert.equal(await evaluate('document.querySelectorAll(".ax-screenshot-composer img").length'),0);
  // Exercise the native file input, including reading the same file again after removal.
  const imagePath=path.join(work,'home.png'); fs.writeFileSync(imagePath,Buffer.from(png,'base64'));
  const doc=await call('DOM.getDocument'); const inputNode=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});
  await call('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[imagePath]}); await wait('document.querySelectorAll(".ax-screenshot-composer img").length===1');
  await click('[aria-label="移除截图 1"]');
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['x'],'fake.gif',{type:'image/gif'}));document.querySelector('section').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelector("[role=alert]")?.textContent.includes("仅支持")');
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(window.makeImage());document.querySelector('section').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelectorAll(".ax-screenshot-composer img").length===1');
  await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;canvas.getContext('2d').fillRect(0,0,32,24);const transfer=new DataTransfer();for(const type of ['image/jpeg','image/webp']){const blob=await(await fetch(canvas.toDataURL(type))).blob();transfer.items.add(new File([blob],type==='image/jpeg'?'photo.jpg':'page.webp',{type}));}document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelectorAll(".ax-screenshot-composer img").length===3');
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(window.makeImage());document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelector("[role=alert]")?.textContent.includes("最多")');
  assert.equal(await evaluate('document.querySelectorAll(".ax-screenshot-composer img").length'),3);
  await click('[aria-label="移除截图 3"]'); await click('[aria-label="移除截图 2"]');
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(8*1024*1024+1)],'oversized.png',{type:'image/png'}));document.querySelector('section').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelector("[role=alert]")?.textContent.includes("8 MB")');
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['broken'],'broken.png',{type:'image/png'}));document.querySelector('section').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await wait('document.querySelector("[role=alert]")?.textContent.includes("内容无效")');
  assert.equal(await evaluate('document.querySelectorAll("[data-page-skeleton]").length'),0,'a failed read removes its skeleton');
  await click('[aria-label="移除截图 1"]');
  await call('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[imagePath]}); await wait('document.querySelectorAll(".ax-screenshot-composer img").length===1');
  const out=process.env.SCREENSHOT_PROTOTYPE_SCREENSHOTS; if(out)fs.mkdirSync(out,{recursive:true});
  const screenshot=async name=>{if(out){const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name),Buffer.from(image.data,'base64'));}};
  await screenshot('desktop.png');
  await evaluate('document.documentElement.classList.add("dark");document.body.style.background="#0f172a"');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,document.body.scrollHeight)'); await delay(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'narrow layout fits viewport');
  const darkBackground = await evaluate('getComputedStyle(document.querySelector(".ax-screenshot-composer")).backgroundColor');
  assert(darkBackground === 'rgb(2, 6, 23)' || darkBackground.startsWith('oklch(0.129 '), `dark composer has a dark surface: ${darkBackground}`);
  await screenshot('narrow-dark.png');
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log('PASS: eight cards, focus, paste, file upload, drag/drop, validation, actual image payload, loading/error/retry, removal, narrow dark layout. No real AI called.');
} finally {
  if(ws)ws.close();
  if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill('SIGTERM');await exited;}
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(work,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
