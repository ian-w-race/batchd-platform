// Tests for the database selection block (BATCHD_ENV) shared by the five app
// pages. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const start = html.indexOf('// Database selection (2026-10-24).');
const end = html.indexOf('const sb = supabase.createClient');
const CODE = html.slice(start, end);

function load(host) {
  const opened = [];
  const body = { children: [], appendChild(c) { this.children.push(c); } };
  const location = { hostname: host, origin: 'https://' + host };
  const document = {
    readyState: 'complete', body,
    createElement: () => ({ setAttribute(k, v) { this[k] = v; } }),
    addEventListener() {},
  };
  const window = { open: (u) => { opened.push(u); } };
  const r = new Function('location', 'document', 'window',
    CODE + '; return { BATCHD_ENV, SUPABASE_URL, SUPABASE_KEY, batchdLink };')(location, document, window);
  return { ...r, badges: body.children.length, window, opened };
}

const PROD = 'https://lurxucdmrugikdlvvebc.supabase.co';
const STAGING = 'https://tiwrrocdwljazweveeth.supabase.co';

test('real domains use production with no badge', () => {
  for (const h of ['corporate.batchdapp.com', 'app.batchdapp.com', 'www.batchdapp.com', 'batchdapp.com',
                   'batchd-app.netlify.app', 'gentle-belekoy-be3cb7.netlify.app']) {
    const r = load(h);
    assert.equal(r.BATCHD_ENV, 'production', h);
    assert.equal(r.SUPABASE_URL, PROD, h);
    assert.equal(r.badges, 0, h);
    assert.equal(r.batchdLink('https://x.example', '/y'), 'https://x.example', h);
  }
});

test('previews, branch deploys and localhost use staging with a badge', () => {
  for (const h of ['deploy-preview-12--gentle-belekoy-be3cb7.netlify.app', 'staging--batchd-app.netlify.app',
                   'localhost', '127.0.0.1']) {
    const r = load(h);
    assert.equal(r.BATCHD_ENV, 'staging', h);
    assert.equal(r.SUPABASE_URL, STAGING, h);
    assert.equal(r.badges, 1, h);
    assert.equal(r.batchdLink('https://x.example', '/y'), '/y', h);
  }
});

test('look-alike hosts outside netlify.app stay on production', () => {
  for (const h of ['deploy-preview-1--evil.example.com', 'batchdapp.com.evil.example', 'x--y.netlify.app.evil.example']) {
    assert.equal(load(h).BATCHD_ENV, 'production', h);
  }
});

test('keys match their projects', () => {
  const ref = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  const p = ref(load('corporate.batchdapp.com').SUPABASE_KEY);
  const s = ref(load('localhost').SUPABASE_KEY);
  assert.deepEqual([p.ref, p.role], ['lurxucdmrugikdlvvebc', 'anon']);
  assert.deepEqual([s.ref, s.role], ['tiwrrocdwljazweveeth', 'anon']);
});

test('staging rewrites links to production apps onto the preview origin', () => {
  const r = load('deploy-preview-3--gentle-belekoy-be3cb7.netlify.app');
  const f = r.window.batchdPreviewUrl;
  const o = 'https://deploy-preview-3--gentle-belekoy-be3cb7.netlify.app';
  assert.equal(f('https://batchd-app.netlify.app'), o + '/');
  assert.equal(f('https://batchd-app.netlify.app?view=history&lot=A1'), o + '/?view=history&lot=A1');
  assert.equal(f('https://app.batchdapp.com/dashboard.html?panel=recalls'), o + '/dashboard.html?panel=recalls');
  assert.equal(f('https://corporate.batchdapp.com/'), o + '/dashboard.html');
  assert.equal(f('https://app.batchdapp.com/signup'), o + '/signup');
  assert.equal(f('https://www.fda.gov/recalls'), 'https://www.fda.gov/recalls');
  r.window.open('https://batchd-app.netlify.app', '_blank');
  r.window.open('', '_blank');
  assert.deepEqual(r.opened, [o + '/', '']);
});

test('production does not install the link rewriter', () => {
  assert.equal(load('corporate.batchdapp.com').window.batchdPreviewUrl, undefined);
});
