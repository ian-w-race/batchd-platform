// scripts/check.mjs — repository checks run by GitHub Actions on every pull
// request and every push to main (.github/workflows/checks.yml). Run locally
// with:  node scripts/check.mjs
//
// No dependencies. Each check prints PASS or FAIL; the script exits 1 if any
// check fails. Add a check here whenever CLAUDE.md says "keep X in step".

import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};

const APP_PAGES = ['index.html', 'dashboard.html', 'signup.html', 'join.html', 'admin.html'];
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html'));

// Inline <script> blocks (no src, not JSON-LD) of an HTML file.
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// 1. Syntax of every inline script block in every page.
check('Inline scripts parse (node --check)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchd-check-'));
  let blocks = 0;
  const bad = [];
  for (const f of htmlFiles) {
    inlineScripts(read(f)).forEach((code, i) => {
      const p = join(dir, `${f}.${i}.js`);
      writeFileSync(p, code);
      blocks++;
      try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
      catch (e) { bad.push(`${f} block ${i + 1}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
    });
  }
  if (bad.length) throw new Error(bad.join('\n'));
  return `${blocks} blocks in ${htmlFiles.length} pages`;
});

// 2. Syntax of every Netlify function and shared library.
check('Netlify functions parse (node --check)', () => {
  const files = [
    ...readdirSync(join(ROOT, 'netlify/functions')).filter((f) => f.endsWith('.js')).map((f) => `netlify/functions/${f}`),
    ...readdirSync(join(ROOT, 'netlify/lib')).filter((f) => f.endsWith('.js')).map((f) => `netlify/lib/${f}`),
  ];
  const bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { bad.push(`${f}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
  }
  if (bad.length) throw new Error(bad.join('\n'));
  return `${files.length} files`;
});

// 3. The database selection block (BATCHD_ENV) is identical in the five app pages.
check('Database selection block identical in all app pages', () => {
  const blocks = APP_PAGES.map((f) => {
    const s = read(f);
    const a = s.indexOf('// Database selection (2026-10-24).');
    const b = s.indexOf('supabase.createClient(SUPABASE_URL, SUPABASE_KEY)');
    if (a < 0 || b < 0 || b < a) throw new Error(`${f}: block or client creation not found`);
    // index.html has unrelated code between the block and createClient; compare up to
    // the end of the staging IIFE, which closes with the click listener.
    const end = s.indexOf('}, true);\n  })();\n}\n', a);
    if (end < 0) throw new Error(`${f}: end of block not found`);
    return s.slice(a, end);
  });
  const ref = blocks[0];
  const diff = APP_PAGES.filter((f, i) => blocks[i] !== ref);
  if (diff.length) throw new Error(`differs from index.html: ${diff.join(', ')}`);
  return `${APP_PAGES.length} pages`;
});

// 4. Only public (anon) Supabase keys are embedded in pages.
check('Only anon Supabase keys in pages', () => {
  const found = new Map();
  for (const f of htmlFiles) {
    for (const jwt of read(f).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role !== 'anon') throw new Error(`${f}: embedded JWT has role "${payload.role}"`);
      found.set(payload.ref, (found.get(payload.ref) || 0) + 1);
    }
  }
  for (const f of htmlFiles) if (/service_role|sb_secret_/.test(read(f))) throw new Error(`${f}: mentions a secret key type`);
  return [...found].map(([ref, n]) => `${ref} x${n}`).join(', ');
});

// 5. FSMA 204 export columns are identical in the dashboard and the scanner.
check('FSMA204_EXPORT_HEADERS identical in dashboard and scanner', () => {
  const get = (f) => {
    const s = read(f);
    const m = s.match(/const FSMA204_EXPORT_HEADERS = (\[[\s\S]*?\]);/);
    if (!m) throw new Error(`${f}: FSMA204_EXPORT_HEADERS not found`);
    return JSON.stringify(new Function(`return ${m[1]}`)());
  };
  const a = get('dashboard.html'), b = get('index.html');
  if (a !== b) throw new Error('header lists differ');
  return `${JSON.parse(a).length} columns`;
});

// 6. Regulatory citations agree between the dashboard and the scanner.
check('US citation table agrees in dashboard and scanner', () => {
  const get = (f, marker) => {
    const s = read(f);
    const a = s.indexOf(marker);
    if (a < 0) throw new Error(`${f}: ${marker} not found`);
    const body = s.slice(a, s.indexOf('rfrRetail', a));
    const map = {};
    for (const m of body.matchAll(/^\s*(\w+):\s*'([^']*)'/gm)) map[m[1]] = m[2];
    return map;
  };
  const d = get('dashboard.html', 'const _CITATIONS = {');
  const i = get('index.html', 'window._CITATIONS = {');
  const keys = Object.keys(d);
  const bad = keys.filter((k) => d[k] !== i[k]);
  if (bad.length) throw new Error(bad.map((k) => `${k}: dashboard "${d[k]}" vs scanner "${i[k]}"`).join('; '));
  return `${keys.length} citations`;
});

// 7. Private files and folders stay blocked on the public site.
check('Private paths forced to 404 in netlify.toml', () => {
  const toml = read('netlify.toml');
  const must = ['/CLAUDE.md', '/SECRETS.md', '/SCHEMA.md', '/SMOKE.md', '/CHECK_MIGRATIONS.sql', '/netlify.toml',
    '/package.json', '/migrations/*', '/docs/*', '/netlify/*', '/scripts/*', '/tests/*', '/.github/*'];
  const missing = must.filter((p) => !new RegExp(`from = "${p.replace(/[.*]/g, (c) => '\\' + c)}"[\\s\\S]{0,60}status = 404`).test(toml));
  if (missing.length) throw new Error(`no forced 404 for: ${missing.join(', ')}`);
  return `${must.length} paths`;
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
