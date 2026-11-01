// Tests for the central sign-in router in login.html (Phase 2a of
// docs/PORTALS-PLAN.md). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const a = html.indexOf('// ROUTER START');
const b = html.indexOf('// ROUTER END');
const { batchdRoute, batchdOrderApps, BATCHD_APPS } = new Function(
  html.slice(a, b) + '; return { batchdRoute, batchdOrderApps, BATCHD_APPS };')();

const m = (role, extra = {}) => ({ role, active: true, is_batched_admin: false, organisations: { type: 'retailer' }, ...extra });

test('no membership goes to signup', () => {
  assert.deepEqual(batchdRoute([]), { kind: 'signup' });
  assert.deepEqual(batchdRoute(null), { kind: 'signup' });
});

test('store staff go straight to the scanner', () => {
  assert.deepEqual(batchdRoute([m('staff')]), { kind: 'apps', apps: ['scan'] });
});

test('retail admins and store managers choose between Retail and the scanner', () => {
  assert.deepEqual(batchdRoute([m('corp_admin')]).apps, ['retail', 'scan']);
  assert.deepEqual(batchdRoute([m('store_manager')]).apps, ['retail', 'scan']);
});

test('platform admins also see Admin', () => {
  assert.deepEqual(batchdRoute([m('corp_admin', { is_batched_admin: true })]).apps, ['retail', 'scan', 'admin']);
});

test('legacy manufacturer members go to the manufacturer page only', () => {
  assert.deepEqual(batchdRoute([m('mfr_admin', { organisations: { type: 'manufacturer' } })]).apps, ['manufacturer']);
  assert.deepEqual(batchdRoute([m('mfr_qa', { organisations: null })]).apps, ['manufacturer']);
});

test('deactivated members see the deactivated screen, not an app', () => {
  assert.deepEqual(batchdRoute([m('corp_admin', { active: false, organisations: null })]), { kind: 'deactivated' });
  // A deactivated platform admin gets no Admin either.
  assert.deepEqual(batchdRoute([m('staff', { active: false, is_batched_admin: true })]), { kind: 'deactivated' });
});

test('only active memberships count when there are several', () => {
  const r = batchdRoute([m('corp_admin', { active: false }), m('staff')]);
  assert.deepEqual(r.apps, ['scan']);
});

test('an unknown role opens nothing', () => {
  assert.deepEqual(batchdRoute([m('mystery')]), { kind: 'deactivated' });
});

test('the last app used on this device is listed first', () => {
  assert.deepEqual(batchdOrderApps(['retail', 'scan'], 'scan'), ['scan', 'retail']);
  assert.deepEqual(batchdOrderApps(['retail', 'scan'], 'admin'), ['retail', 'scan']);
  assert.deepEqual(batchdOrderApps(['retail', 'scan'], null), ['retail', 'scan']);
});

test('every app path is same-origin and served by netlify.toml or a file', () => {
  const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  for (const [k, app] of Object.entries(BATCHD_APPS)) {
    assert.ok(app.path.startsWith('/') && !app.path.startsWith('//'), k);
    if (!app.path.endsWith('.html')) assert.ok(toml.includes(`from = "${app.path}"`), `${k}: no rule for ${app.path}`);
  }
  assert.ok(toml.includes('from = "/login"'));
  assert.ok(/from = "https:\/\/app\.batchdapp\.com\/"\s+to = "\/login\.html"/.test(toml));
});
