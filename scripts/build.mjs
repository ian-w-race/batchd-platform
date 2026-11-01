// scripts/build.mjs (improvement plan A2, 2026-11-01)
// Builds the site into dist/, which Netlify publishes (netlify.toml [build]).
//   1. Copies the public pages and static files from the repository root
//      (an allowlist: private files such as CLAUDE.md are never copied, and
//      netlify.toml's forced 404s stay as a second line of defense).
//   2. Bundles src/shared/index.js with esbuild into dist/assets/batchd-shared.js,
//      a classic script every page loads before it creates its Supabase client.
// Run: npm run build. The e2e static server and scripts/check.mjs run it too.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Public files at the repository root, by extension, plus these folders.
const PUBLIC_EXT = new Set(['.html', '.png', '.ico', '.svg', '.txt', '.webmanifest', '.xml']);
const PUBLIC_ROOT_JS = new Set(['complaint-widget.js']);
const PUBLIC_DIRS = ['fonts'];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'assets'), { recursive: true });

const copied = [];
for (const name of readdirSync(ROOT)) {
  const p = join(ROOT, name);
  if (!statSync(p).isFile()) continue;
  if (PUBLIC_EXT.has(extname(name)) || PUBLIC_ROOT_JS.has(name)) { cpSync(p, join(DIST, name)); copied.push(name); }
}
for (const d of PUBLIC_DIRS) { cpSync(join(ROOT, d), join(DIST, d), { recursive: true }); copied.push(d + '/'); }

const result = await build({
  entryPoints: [join(ROOT, 'src/shared/index.js')],
  bundle: true,
  format: 'iife',
  target: ['es2017'],
  outfile: join(DIST, 'assets/batchd-shared.js'),
  minify: false,
  legalComments: 'none',
  banner: { js: '/* Batch\'d shared rules. Built from src/shared by scripts/build.mjs; edit the source, not this file. */' },
  logLevel: 'silent',
});
if (result.errors.length) { console.error(result.errors); process.exit(1); }

writeFileSync(join(DIST, '.built-at'), new Date().toISOString() + '\n');
const size = statSync(join(DIST, 'assets/batchd-shared.js')).size;
console.log(`built dist/: ${copied.length} files and folders copied, assets/batchd-shared.js ${size} bytes`);
