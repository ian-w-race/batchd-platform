// The server-to-server secret is read under its real name only. The
// misspelled key batchd-app once stored it under (2026-10-25) is ignored
// since 2026-11-01, when the fallback was removed.
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
test('the misspelled name is ignored', () => {
  delete process.env.INTERNAL_NOTIFY_SECRET; process.env.INTERNAL_NOTIFY_SECREY = S;
  const a = load(); assert.equal(a.internalSecret(), ''); assert.equal(a.internalSecretOk(S), false);
});
test('the correct name wins when both exist', () => {
  process.env.INTERNAL_NOTIFY_SECRET = S; process.env.INTERNAL_NOTIFY_SECREY = 'c'.repeat(64);
  assert.equal(load().internalSecret(), S);
});
test('neither set fails closed', () => {
  delete process.env.INTERNAL_NOTIFY_SECRET; delete process.env.INTERNAL_NOTIFY_SECREY;
  const a = load(); assert.equal(a.internalSecretOk(''), false); assert.equal(a.internalSecretOk(undefined), false);
});
