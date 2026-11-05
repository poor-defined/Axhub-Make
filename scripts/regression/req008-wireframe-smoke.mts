/** Opt-in real AI smoke test. Creates/edits only a temporary prototype, never a registered user project. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { handleAiRunsApi } from '../../src/server/managementApi.aiRuns.ts';
import { createProjectMetadataStore } from '../../src/server/projectCore/index.ts';
import { buildPrototypeGenerationPrompt } from '../../src/index/domains/prototype-generation/acpPrototypeAgentClient.ts';
import { buildQuickEditAcpPrompt } from '../../src/index/utils/quickEditPrompts.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = process.env.REQ008_CONFIG_PATH || path.join(repo, '.local/development-home/.axhub/make/server.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axhub-wireframe-smoke-'));
const prototypeDir = path.join(root, 'src/prototypes/wireframe-smoke');
fs.mkdirSync(prototypeDir, { recursive: true });
fs.writeFileSync(path.join(prototypeDir, 'index.tsx'), 'export default function Component() { return <main>待生成</main>; }\n');
const metadata = createProjectMetadataStore(root).saveMetadata({
  project: { id: 'wireframe-smoke', name: 'REQ-008 smoke' },
  resourceWriteTargets: { prototypes: { type: 'project-relative-path', path: 'src/prototypes' } },
  resources: { prototypes: [{ id: 'wireframe-smoke', name: 'wireframe-smoke', title: '订单管理',
    clientUrl: 'http://localhost/fixture', filePath: 'src/prototypes/wireframe-smoke/index.tsx' }], themes: [] },
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? sourceFiles(path.join(dir, entry.name))
    : /\.(tsx|jsx|css)$/u.test(entry.name) ? [path.join(dir, entry.name)] : []);
}

function audit(stage: string, requiredLabels: string[]) {
  const files = sourceFiles(prototypeDir);
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const issues: string[] = [];
  if (/(?:linear|radial|conic)-gradient\s*\(/iu.test(source)) issues.push('decorative gradient');
  if (/<img\b|background-image\s*:\s*url/iu.test(source)) issues.push('photo/raster skin');
  if (/(?:bg|text|border|ring)-(?:blue|indigo|purple|pink|cyan|violet|amber|orange)-\d/u.test(source)) issues.push('brand palette');
  for (const match of source.matchAll(/(?:box-shadow|boxShadow)\s*:\s*([^;}\n,]+)/gu)) {
    const value = match[1].trim().replace(/^['"]|['"]$/gu, '');
    if (!['none', '0', 'unset'].includes(value)) issues.push('shadow');
  }
  for (const label of requiredLabels) if (!source.includes(label)) issues.push(`missing business text: ${label}`);
  for (const tag of ['button', 'input', 'table']) if (!new RegExp(`<${tag}\\b`, 'u').test(source)) issues.push(`missing editable ${tag}`);
  const colors = [...new Set(source.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/giu) || [])];
  for (const color of colors) {
    const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
    const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (Math.max(...channels) - Math.min(...channels) > 8) issues.push(`non-gray color: ${color}`);
  }
  const report = { stage, files: files.map((file) => path.relative(root, file)), colors, issues };
  console.log(JSON.stringify(report));
  if (issues.length) throw new Error(`${stage} wireframe audit failed`);
  return report;
}

async function main() {
  const server = http.createServer((req, res) => {
    // Use the existing development UI origin for ACP health/CORS checks.
    req.headers.host = '127.0.0.1:53818';
    handleAiRunsApi(req, res, {} as never, '/api/ai/runs', {
      resolveProjectContext: () => ({ project: { id: 'wireframe-smoke', root }, metadata }),
      getServerConfigStoreForRequest: () => ({ getConfig: () => config }),
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const reports: unknown[] = [];
  async function run(stage: string, prompt: string) {
    console.log(JSON.stringify({ stage, state: 'running', workspace: root }));
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: 'direct', prompt, modeId: 'agent', permissionMode: 'acceptEdits', autoStart: false,
        targetPath: 'src/prototypes/wireframe-smoke/index.tsx' }), signal: AbortSignal.timeout(210_000),
    });
    const raw = await response.text();
    const events = raw.split(/\r?\n\r?\n/u).map((event) => {
      const type = event.match(/^event:\s*(.+)$/mu)?.[1];
      const line = event.split(/\r?\n/u).find((value) => value.startsWith('data:'));
      return { type, data: line ? JSON.parse(line.slice(5).trim()) : null };
    });
    const failed = events.find((event) => event.type === 'run.error');
    if (!response.ok || failed || !events.some((event) => event.type === 'run.completed')) {
      throw new Error(String(failed?.data?.error || `AI run failed: HTTP ${response.status}`));
    }
  }
  try {
    const request = '实现订单管理页面，包含订单编号输入框、查询与重置按钮和订单表格，用原生 HTML 元素和本目录 CSS，不引入组件库。两个按钮 id 分别为 search 和 reset。可参考品牌主题的布局。直接修改当前原型文件，保持能编辑和交互；不要调用浏览器、网络、外部工具，不运行构建或安装依赖。';
    await run('create', buildPrototypeGenerationPrompt({ prompt: request, generatorElementId: 'smoke',
      currentPrototype: { name: 'wireframe-smoke', displayName: '订单管理' } }));
    reports.push(audit('create', ['订单', '查询', '重置']));
    await run('multi-annotation-edit', buildQuickEditAcpPrompt({ currentFilePath: 'src/prototypes/wireframe-smoke/index.tsx',
      selectedElements: [{ tag: 'button', selector: '#search', label: '查询' }, { tag: 'button', selector: '#reset', label: '重置' }],
    }) + '\n本次具体批注：把查询按钮文案改为“搜索订单”，重置按钮改为“清空条件”，增强主次区分。该测试没有本地批注文件，以上两条就是明确批注，不读取其他项目。保持现有字段、表格与交互，不运行浏览器、构建或安装依赖。');
    reports.push(audit('multi-annotation-edit', ['订单', '搜索订单', '清空条件']));
    fs.writeFileSync(path.join(root, 'wireframe-report.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ result: 'passed', workspace: root }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
