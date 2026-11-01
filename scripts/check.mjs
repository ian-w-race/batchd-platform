// scripts/check.mjs — repository checks run by GitHub Actions on every pull
// request and every push to main (.github/workflows/checks.yml). Run locally
// with:  node scripts/check.mjs
//
// No dependencies. Each check prints PASS or FAIL; the script exits 1 if any
// check fails. Add a check here whenever CLAUDE.md says "keep X in step".

import { readFileSync, readdirSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
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

const APP_PAGES = ['index.html', 'dashboard.html', 'signup.html', 'join.html', 'admin.html', 'login.html'];
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

// 3. Every app page loads the shared bundle (src/shared, built by
// scripts/build.mjs) before it creates its Supabase client, and keeps no
// local copy of the database selection block it replaced (A2, 2026-11-01).
check('App pages load the shared bundle and keep no local database block', () => {
  const TAG = '<script src="/assets/batchd-shared.js"></script>';
  const LOCAL = ['const BATCHD_ENV', 'const SUPABASE_URL', 'const SUPABASE_KEY', 'function batchdLink', 'Database selection (2026-10-24)'];
  for (const f of APP_PAGES) {
    const s = read(f);
    const tags = s.split(TAG).length - 1;
    if (tags !== 1) throw new Error(`${f}: expected the shared bundle tag once, found ${tags}`);
    const client = s.indexOf('supabase.createClient(SUPABASE_URL, SUPABASE_KEY)');
    if (client < 0 || s.indexOf(TAG) > client) throw new Error(`${f}: the shared bundle must load before supabase.createClient`);
    for (const l of LOCAL) if (s.includes(l)) throw new Error(`${f}: still defines "${l}" locally; it belongs in src/shared/env.js`);
  }
  return `${APP_PAGES.length} pages`;
});

// 3b. The shared bundle builds, parses, and the build publishes only public files.
check('Site builds into dist/ (scripts/build.mjs)', () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', join(ROOT, 'dist/assets/batchd-shared.js')], { stdio: 'pipe' });
  const out = readdirSync(join(ROOT, 'dist'));
  for (const f of APP_PAGES) if (!out.includes(f)) throw new Error(`dist/ is missing ${f}`);
  const leaked = out.filter((f) => /\.(md|toml|sql|mjs|json|lock)$/i.test(f) || ['netlify', 'migrations', 'docs', 'tests', 'e2e', 'scripts', 'src', 'node_modules'].includes(f));
  if (leaked.length) throw new Error(`dist/ contains private files: ${leaked.join(', ')}`);
  return `${out.length} entries, shared bundle ${statSync(join(ROOT, 'dist/assets/batchd-shared.js')).size} bytes`;
});

// 4. Only public (anon) Supabase keys are embedded in pages and shared modules.
check('Only anon Supabase keys in pages and src/shared', () => {
  const found = new Map();
  const sharedFiles = readdirSync(join(ROOT, 'src/shared')).map((f) => 'src/shared/' + f);
  for (const f of [...htmlFiles, ...sharedFiles]) {
    for (const jwt of read(f).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role !== 'anon') throw new Error(`${f}: embedded JWT has role "${payload.role}"`);
      found.set(payload.ref, (found.get(payload.ref) || 0) + 1);
    }
  }
  for (const f of [...htmlFiles, ...sharedFiles]) if (/service_role|sb_secret_/.test(read(f))) throw new Error(`${f}: mentions a secret key type`);
  return [...found].map(([ref, n]) => `${ref} x${n}`).join(', ');
});

// 5. The FSMA 204 rules live only in src/shared/fsma.js (A2 part 2,
// 2026-11-01): export headers, citations, applicability bands and copy, dollar
// thresholds, the supplier completeness rule and the CSV cell guard. The pages
// read them through Batchd.fsma; a copy pasted back into a page fails here.
check('FSMA rules come only from src/shared/fsma.js', () => {
  const PAGES = ['dashboard.html', 'index.html', 'signup.html'];
  const LOCAL = [
    'const FSMA204_EXPORT_HEADERS = [', 'const _CITATIONS = {\n', 'window._CITATIONS = {\n',
    'const _FSMA_APPLICABILITY = {\n', 'window._FSMA_APPLICABILITY_COPY = {\n', 'const _FSMA_COPY = {',
    'const _FSMA_BANDS = {', 'function _fsmaCsvCell(', 'return !!(s && s.name && s.phone', 'return !!(x && x.name && x.phone',
    'FSMA204_EXPORT_DISCLAIMER = "',
  ];
  let uses = 0;
  for (const f of PAGES) {
    const s = read(f);
    for (const l of LOCAL) if (s.includes(l)) throw new Error(`${f}: still defines "${l.trim()}" locally; it belongs in src/shared/fsma.js`);
    const dollars = s.match(/\$\d[\d,]*(?:,000| million)/g) || [];
    if (dollars.length) throw new Error(`${f}: dollar thresholds ${dollars.join(', ')} must come from Batchd.fsma.THRESHOLDS`);
    const n = (s.match(/Batchd\.fsma\./g) || []).length;
    if (!n) throw new Error(`${f}: does not read Batchd.fsma`);
    uses += n;
  }
  const mod = read('src/shared/fsma.js');
  const headers = (mod.match(/export const FSMA204_EXPORT_HEADERS = Object\.freeze\(\[([\s\S]*?)\]\);/) || [])[1];
  if (!headers) throw new Error('src/shared/fsma.js: FSMA204_EXPORT_HEADERS not found');
  const count = (headers.match(/"/g) || []).length / 2;
  if (count !== 27) throw new Error(`src/shared/fsma.js: ${count} export columns, expected 27`);
  return `${PAGES.length} pages, ${uses} reads, 27 columns`;
});

// 7c. Every function reads its database from SUPABASE_URL, so deploy previews
// can point at staging. Production stays the fallback.
check('Functions read SUPABASE_URL from the environment', () => {
  const files = readdirSync('netlify/functions').filter((f) => f.endsWith('.js')).map((f) => 'netlify/functions/' + f).concat('netlify/lib/auth.js');
  const bad = files.filter((f) => /supabase\.co/.test(read(f)) && !/process\.env\.SUPABASE_URL\s*\|\|/.test(read(f)));
  if (bad.length) throw new Error('hardcoded database URL in ' + bad.join(', '));
  return files.length + ' files';
});

// 7. Private files and folders stay blocked on the public site.
check('Private paths forced to 404 in netlify.toml', () => {
  const toml = read('netlify.toml');
  const must = ['/CLAUDE.md', '/SECRETS.md', '/SCHEMA.md', '/SMOKE.md', '/CHECK_MIGRATIONS.sql', '/netlify.toml',
    '/package.json', '/migrations/*', '/docs/*', '/netlify/*', '/scripts/*', '/tests/*', '/e2e/*', '/playwright.config.mjs', '/.github/*'];
  const missing = must.filter((p) => !new RegExp(`from = "${p.replace(/[.*]/g, (c) => '\\' + c)}"[\\s\\S]{0,60}status = 404`).test(toml));
  if (missing.length) throw new Error(`no forced 404 for: ${missing.join(', ')}`);
  return `${must.length} paths`;
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
