// Tests for the scanner's hand-off from batchd-app.netlify.app to
// app.batchdapp.com/scan (Phase 2a step 2). Run: node --test tests/
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('// One address (2026-11-01, Phase 2a step 2): the scanner moved');
const end = html.indexOf('})();\n</script>', start) + '})();'.length;
const CODE = html.slice(start, end);

function run(host, queue) {
  const store = { batched_offline_queue: typeof queue === 'string' ? queue : JSON.stringify(queue) };
  const els = {};
  const body = {
    children: [],
    appendChild(c) { this.children.push(c); if (c.id) els[c.id] = c; },
  };
  const document = {
    readyState: 'complete', body,
    createElement: () => {
      const el = { style: {}, setAttribute(k, v) { this[k] = v; }, remove() { body.children = body.children.filter((x) => x !== el); delete els[el.id]; } };
      return el;
    },
    getElementById: (id) => els[id] || null,
    addEventListener() {},
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  const window = {};
  new Function('location', 'document', 'localStorage', 'window', CODE)({ hostname: host }, document, localStorage, window);
  return { window, body, els, store };
}

test('other hosts are untouched', () => {
  for (const h of ['app.batchdapp.com', 'deploy-preview-40--batchd-app.netlify.app', 'localhost']) {
    const r = run(h, []);
    assert.equal(r.window._batchdMoved, undefined, h);
    assert.equal(r.body.children.length, 0, h);
  }
});

test('with nothing queued the old address shows the moved screen at once', () => {
  const r = run('batchd-app.netlify.app', []);
  assert.equal(r.window._batchdMoved, true);
  assert.ok(r.els['batchd-moved']);
  assert.match(r.els['batchd-moved'].innerHTML, /https:\/\/app\.batchdapp\.com\/scan/);
  assert.match(r.els['batchd-moved'].innerHTML, /has moved/);
});

test('saved scans sync first; the moved screen waits until the queue is empty', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const r = run('batchd-app.netlify.app', [{ kind: 'scan' }, { kind: 'receiving' }]);
    assert.equal(r.window._batchdMoved, false);
    assert.ok(r.els['batchd-move-banner']);
    assert.match(r.els['batchd-move-banner'].textContent, /Sending 2 saved scans first/);
    assert.equal(r.els['batchd-moved'], undefined);
    r.store.batched_offline_queue = JSON.stringify([{ kind: 'scan' }]);
    mock.timers.tick(5000);
    assert.match(r.els['batchd-move-banner'].textContent, /Sending 1 saved scan first/);
    r.store.batched_offline_queue = '[]';
    mock.timers.tick(5000);
    assert.equal(r.window._batchdMoved, true);
    assert.ok(r.els['batchd-moved']);
    assert.equal(r.els['batchd-move-banner'], undefined);
  } finally {
    mock.timers.reset();
  }
});

test('a broken queue value counts as empty rather than trapping the phone', () => {
  const r = run('batchd-app.netlify.app', 'not json');
  assert.equal(r.window._batchdMoved, true);
  assert.ok(r.els['batchd-moved']);
});
