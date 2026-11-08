import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Use tsx's existing build dependency; no additional package is needed.
const require = createRequire(import.meta.url);
const { build } = require(createRequire(require.resolve('tsx/package.json')).resolve('esbuild'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'vendor/axhub-commentary');
const options = {
  absWorkingDir: packageRoot,
  bundle: true,
  packages: 'external',
  platform: 'browser',
  target: 'es2020',
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  jsx: 'automatic',
  logLevel: 'info',
};

await build({
  ...options,
  entryPoints: { index: 'src/index.ts', 'prompt-card-skills': 'src/prompt-card-skills.ts' },
  outdir: path.join(packageRoot, 'dist'),
  outExtension: { '.js': '.mjs' },
  format: 'esm',
  splitting: true,
});
await build({ ...options, entryPoints: ['src/index.ts'], outfile: path.join(packageRoot, 'dist/index.js'), format: 'cjs' });
await build({ ...options, entryPoints: ['src/prompt-card-skills.ts'], outfile: path.join(packageRoot, 'dist/prompt-card-skills.js'), format: 'cjs' });
