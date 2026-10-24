// index.html: fetchUserProfile must not throw when applyManagerUI (a later
// script block) has not parsed yet (2026-10-24). Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = html.indexOf('function _applyManagerUISafe(isManager) {');
const b = html.indexOf('\n}\n', a) + 3;
const HELPER = html.slice(a, b);

test('fetchUserProfile routes every applyManagerUI call through the safe helper', () => {
  const start = html.indexOf('async function fetchUserProfile');
  const end = html.indexOf('function applyManagerUI(isManager) {');
  const body = html.slice(start, end);
  assert.equal((body.match(/[^_]applyManagerUI\(/g) || []).length, 0);
  assert.equal((body.match(/_applyManagerUISafe\(/g) || []).length, 3);
});

test('defers until DOMContentLoaded when applyManagerUI is not defined yet', () => {
  const listeners = {};
  const document = { addEventListener: (t, f) => { listeners[t] = f; } };
  const calls = [];
  const scope = { applyManagerUI: undefined };
  const run = new Function('document', 'scope', `
    ${HELPER.replace(/applyManagerUI\(isManager\)/g, 'scope.applyManagerUI(isManager)').replace("typeof applyManagerUI", "typeof scope.applyManagerUI")}
    return _applyManagerUISafe;`)(document, scope);
  assert.doesNotThrow(() => run(true));
  assert.equal(typeof listeners.DOMContentLoaded, 'function');
  scope.applyManagerUI = (v) => calls.push(v);
  listeners.DOMContentLoaded();
  assert.deepEqual(calls, [true]);
});

test('calls straight through when applyManagerUI already exists', () => {
  const calls = [];
  const scope = { applyManagerUI: (v) => calls.push(v) };
  const run = new Function('document', 'scope', `
    ${HELPER.replace(/applyManagerUI\(isManager\)/g, 'scope.applyManagerUI(isManager)').replace("typeof applyManagerUI", "typeof scope.applyManagerUI")}
    return _applyManagerUISafe;`)({ addEventListener() { throw new Error('should not wait'); } }, scope);
  run(false);
  assert.deepEqual(calls, [false]);
});
