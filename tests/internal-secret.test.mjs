// The server-to-server secret is accepted under its real name and, as a
// fallback, under the misspelled key batchd-app stored it as (2026-10-25).
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const load = () => { delete require.cache[require.resolve('../netlify/lib/auth.js')]; return require('../netlify/lib/auth.js'); };
const S = 'a'.repeat(64);

test('correct name works', () => {
  delete process.env.INTERNAL_NOTIFY_SECREY; process.env.INTERNAL_NOTIFY_SECRET = S;
  const a = load(); assert.equal(a.internalSecretOk(S), true); assert.equal(a.internalSecretOk('b'.repeat(64)), false);
});
test('misspelled name works as a fallback', () => {
  delete process.env.INTERNAL_NOTIFY_SECRET; process.env.INTERNAL_NOTIFY_SECREY = S;
  const a = load(); assert.equal(a.internalSecret(), S); assert.equal(a.internalSecretOk(S), true);
});
test('the correct name wins when both exist', () => {
  process.env.INTERNAL_NOTIFY_SECRET = S; process.env.INTERNAL_NOTIFY_SECREY = 'c'.repeat(64);
  assert.equal(load().internalSecret(), S);
});
test('neither set fails closed', () => {
  delete process.env.INTERNAL_NOTIFY_SECRET; delete process.env.INTERNAL_NOTIFY_SECREY;
  const a = load(); assert.equal(a.internalSecretOk(''), false); assert.equal(a.internalSecretOk(undefined), false);
});
