// Copies a single-threaded Stockfish WASM build from node_modules into
// public/engine so it can be loaded as a plain Worker script at runtime.
// Single-threaded build is deliberate: multi-threaded WASM needs COOP/COEP
// headers, which we don't want to require from static hosting.
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'stockfish', 'src');
const outDir = join(root, 'public', 'engine');

if (!existsSync(srcDir)) {
  console.warn('[copy-engine] stockfish package not found; skipping');
  process.exit(0);
}

const files = readdirSync(srcDir);
// Prefer the lite single-threaded build (small NNUE net, no SharedArrayBuffer).
const pick = (patterns) => {
  for (const p of patterns) {
    const js = files.find((f) => p.test(f) && f.endsWith('.js'));
    if (js) return js;
  }
  return null;
};
const js = pick([/lite-single/, /single/, /no-Worker/i]);
if (!js) {
  console.error('[copy-engine] no single-threaded stockfish build found in', files);
  process.exit(1);
}
const base = js.replace(/\.js$/, '');
mkdirSync(outDir, { recursive: true });
for (const f of files) {
  if (f.startsWith(base)) cpSync(join(srcDir, f), join(outDir, f));
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ worker: js }));
console.log(`[copy-engine] copied ${base}.* to public/engine`);
