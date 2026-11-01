// The shared design tokens (src/shared/design-tokens.css, improvement plan A2
// part 4). The scanner, Retail and the sign-in page link the built copy at
// /assets/design-tokens.css instead of carrying inline copies. These tests
// hold the rules in CLAUDE.md, "Design system". Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/shared/design-tokens.css', import.meta.url), 'utf8');

// Blocks by selector: { selector: { '--name': 'value' } }
function blocks(text) {
  const out = {};
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');   // comments carry no tokens
  const re = /(^|\n)([^{}\n][^{]*?)\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    const sel = m[2].replace(/\s+/g, ' ').trim();
    const body = m[3];
    out[sel] = Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((x) => [x[1], x[2].trim()]));
  }
  return out;
}
const b = blocks(css);
const dark = b[':root, [data-theme="dark"]'];
const light = b['[data-theme="light"]'];
const scale = b[':root'];
const aliases = b[':root, [data-theme]'];
const lower = (v) => String(v).toLowerCase();

test('the four token blocks are present', () => {
  assert.ok(dark && light && scale && aliases, Object.keys(b).join(' | '));
  assert.ok(Object.keys(dark).length >= 50 && Object.keys(light).length >= 50, 'semantic tokens');
  assert.ok(Object.keys(scale).length >= 50, 'scale tokens');
  assert.ok(Object.keys(aliases).length >= 20, 'legacy aliases');
});

test('dark is canonical: no pure black, no pure white text, mint accent', () => {
  assert.equal(lower(dark['--background-base']), '#080f12');
  assert.equal(lower(dark['--text-primary']), '#eaf6f0');
  assert.equal(lower(dark['--accent-primary']), '#34d399');
  assert.equal(dark['color-scheme'], undefined); // color-scheme is a property, not a token
  for (const [k, v] of Object.entries(dark)) {
    assert.ok(!/#000000\b|#000\b/i.test(v), `${k} uses pure black`);
    if (/^--text-/.test(k)) assert.ok(!/#ffffff\b|#fff\b/i.test(v), `${k} uses pure white`);
  }
  assert.match(css, /color-scheme:\s*dark/);
});

test('light is its own palette with the emerald accent', () => {
  assert.equal(lower(light['--background-base']), '#f5f7f6');
  assert.equal(lower(light['--text-primary']), '#0e1f1a');
  assert.equal(lower(light['--accent-primary']), '#077a55');
  // Every light token overrides a dark one, apart from the theme-invariant scrim.
  const missing = Object.keys(light).filter((k) => !(k in dark));
  assert.deepEqual(missing, []);
  assert.ok('--scrim-rgb' in dark && !('--scrim-rgb' in light), 'the camera scrim is theme-invariant');
  assert.match(css, /color-scheme:\s*light/);
});

test('the type, radius and motion ladders are the documented ones', () => {
  assert.deepEqual(
    ['--fs-label', '--fs-eyebrow', '--fs-meta', '--fs-body', '--fs-body-lg', '--fs-h4', '--fs-h3', '--fs-h2', '--fs-h1'].map((k) => scale[k]),
    ['10px', '11px', '12px', '13px', '15px', '17px', '22px', '28px', '46px']);
  assert.deepEqual(
    ['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-2xl', '--r-pill'].map((k) => scale[k]),
    ['6px', '8px', '10px', '12px', '16px', '20px', '999px']);
  assert.deepEqual([scale['--dur-fast'], scale['--dur-normal'], scale['--dur-slow']], ['0.15s', '0.20s', '0.40s']);
  assert.ok(scale['--ease-out'] && scale['--font-mono'] && scale['--font-display']);
});

test('legacy aliases point at semantic tokens', () => {
  for (const k of ['--bg', '--surface', '--surface2', '--text', '--muted', '--accent', '--border', '--danger', '--warn', '--info', '--success']) {
    assert.ok(aliases[k], k + ' missing');
    assert.match(aliases[k], /^var\(--/, `${k} should alias a semantic token`);
  }
});
