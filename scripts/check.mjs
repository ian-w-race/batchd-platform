// scripts/check.mjs — repository checks run by GitHub Actions on every pull
// request and every push to main (.github/workflows/checks.yml). Run locally
// with:  node scripts/check.mjs
//
// No dependencies. Each check prints PASS or FAIL; the script exits 1 if any
// check fails. Add a check here whenever CLAUDE.md says "keep X in step".

import { readFileSync, readdirSync, writeFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
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

// 6. The GS1 parser, the listed-food table and detector, and the recall
// matcher live only in src/shared (A2 part 3, 2026-11-01); the scanner,
// dashboard and signup read them through Batchd.gs1, Batchd.ftl and
// Batchd.recall, and the category labels are one list.
check('Parsers, listed-food table and recall matcher come only from src/shared', () => {
  const LOCAL = {
    'index.html': ['function parseGS1(', 'function parseGS1DigitalLink(', 'function _gs1ParseDate(', 'function extractBestBefore(',
      'const FTL_CATEGORIES = {', 'function detectFtlCategory(', 'function normaliseProductKey(',
      'function levenshtein(', 'function fuzzyProductMatch(', 'return { level: \'exact\', recall, matched_on:'],
    'dashboard.html': ['const _SUPPLIER_CATEGORIES = {'],
    'signup.html': ['const _FOCUS_LABELS = {'],
  };
  const NEEDS = { 'index.html': ['Batchd.gs1.', 'Batchd.ftl.', 'Batchd.recall.'], 'dashboard.html': ['Batchd.ftl.ftlLabels()'], 'signup.html': ['Batchd.ftl.ftlLabels()'] };
  for (const [f, list] of Object.entries(LOCAL)) {
    const s = read(f);
    for (const l of list) if (s.includes(l)) throw new Error(`${f}: still defines "${l}" locally; it belongs in src/shared`);
    for (const n of NEEDS[f]) if (!s.includes(n)) throw new Error(`${f}: does not read ${n}`);
  }
  const ftl = read('src/shared/ftl.js');
  const labels = ftl.match(/^    label: '([^']*)'/gm) || [];
  if (labels.length !== 17) throw new Error(`src/shared/ftl.js: ${labels.length} category labels, expected 17`);
  for (const l of labels) if (/\b(Molluscs|Semi-Soft)\b/.test(l) || /^    label: '[A-Z][a-z]+ [A-Z]/.test(l)) throw new Error(`src/shared/ftl.js: label not in house style: ${l.trim()}`);
  return `3 pages, ${labels.length} categories`;
});

// 6c. The scanner reads "the active recalls" only through the database
// function batchd_active_recalls (B4 stage 4, 2026-11-08): no page query of
// recall_distributions or recall_events, and the one normalizer and the two
// match-row rules come from src/shared/active-recalls.js. The Retail app
// moves in stage 5; the manual-recall management lists still read `recalls`
// on purpose (CLAUDE.md, "Database rules").
check('Scanner and Retail read active recalls only through batchd_active_recalls', () => {
  const s = read('index.html');
  for (const q of ["from('recall_distributions')", "from('recall_events')", '_loadClosedEventIds(']) {
    if (s.includes(q)) throw new Error(`index.html: still contains ${q}; active recalls come from batchd_active_recalls`);
  }
  for (const n of ["rpc('batchd_active_recalls'", 'Batchd.activeRecalls.normalizeActiveRecalls(', 'Batchd.activeRecalls.matchIdColumns(', 'Batchd.activeRecalls.exactIdentifierHit(']) {
    if (!s.includes(n)) throw new Error(`index.html: does not call ${n}`);
  }
  const activePair = /from\('recalls'\)\.select\([^)]*\)(\.eq\('organisation_id', [^)]*\))?\.eq\('active', true\)/g;
  const pairs = (s.match(activePair) || []).length;
  if (pairs) throw new Error(`index.html: ${pairs} direct "active recalls" quer${pairs === 1 ? 'y' : 'ies'} on the recalls table left`);
  // Retail (B4 stage 5): no query pair of recall_distributions joined to
  // recall_events, no unfiltered recall_events list, no "active recalls"
  // query on the recalls table. Reads by event id (Live Recall, drills,
  // the Recalls panel's History tab) and the Consumer Notify picker, which
  // needs events closed within 30 days, stay.
  const d = read('dashboard.html');
  for (const q of [".eq('recall_events.is_drill', false)", "recall_events!inner(id", ".select('id').eq('is_drill', false).is('closed_at', null)", ".eq('is_drill', false).order('published_at'"]) {
    if (d.includes(q)) throw new Error(`dashboard.html: still contains ${q}; active recalls come from batchd_active_recalls`);
  }
  const dPairs = (d.match(activePair) || []).length;
  if (dPairs) throw new Error(`dashboard.html: ${dPairs} direct "active recalls" quer${dPairs === 1 ? 'y' : 'ies'} on the recalls table left`);
  for (const n of ["rpc('batchd_active_recalls'", 'Batchd.activeRecalls.normalizeActiveRecalls(', "from('recall_catalog_org')"]) {
    if (!d.includes(n)) throw new Error(`dashboard.html: does not use ${n}`);
  }
  const shared = read('src/shared/active-recalls.js');
  for (const fn of ['export function normalizeActiveRecalls(', 'export function exactIdentifierHit(', 'export function matchIdColumns(']) {
    if (!shared.includes(fn)) throw new Error(`src/shared/active-recalls.js: ${fn.slice(16, -1)} missing`);
  }
  return `scanner ${(s.match(/_fetchActiveRecalls\(/g) || []).length - 1} callers, Retail ${(d.match(/_fetchActiveRecalls\(/g) || []).length - 1} callers`;
});

// 6b. The design tokens live only in src/shared/design-tokens.css (A2 part 4,
// 2026-11-01); the scanner, Retail and the sign-in page link the built copy
// before their own styles and declare none of the shared tokens inline.
check('Design tokens come only from src/shared/design-tokens.css', () => {
  const LINK = '<link rel="stylesheet" href="/assets/design-tokens.css">';
  const SHARED = ['--background-base:', '--text-primary:', '--accent-primary:', '--fs-body:', '--r-md:', '--dur-fast:', '--bg:', '--surface:', '--muted:', '--accent:'];
  for (const f of ['index.html', 'dashboard.html', 'login.html']) {
    const s = read(f);
    const link = s.indexOf(LINK), style = s.indexOf('<style');
    if (link < 0) throw new Error(`${f}: does not link /assets/design-tokens.css`);
    if (link > style) throw new Error(`${f}: the tokens stylesheet must come before the page's own <style>`);
    for (const t of SHARED) if (new RegExp('^\\s*' + t.replace(/-/g, '\\-'), 'm').test(s)) throw new Error(`${f}: still declares ${t.slice(0, -1)} inline; it belongs in src/shared/design-tokens.css`);
  }
  const css = read('src/shared/design-tokens.css');
  for (const sel of [':root,\n[data-theme="dark"] {', '[data-theme="light"] {', '\n:root {', ':root, [data-theme] {']) if (!css.includes(sel)) throw new Error(`design-tokens.css: block ${JSON.stringify(sel)} missing`);
  if (!existsSync(join(ROOT, 'dist/assets/design-tokens.css'))) throw new Error('dist/assets/design-tokens.css missing after the build');
  return `3 pages, ${(css.match(/--[a-z0-9-]+\s*:/g) || []).length} declarations`;
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
