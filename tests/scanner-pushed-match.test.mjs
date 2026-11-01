// Tests for the two helpers that key a pushed recall's scan_recall_matches
// row to the LINKED recalls row (index.html, 2026-11-01), loaded straight
// from the page so the tests exercise the shipping code:
//   _attachLinkedRecalls   hangs the linked recalls rows on each pushed recall
//   _pushedMatchRecallId   picks the linked row a scan's match row points at
// scan_recall_matches.recall_id has a foreign key to recalls(id), so the
// event id can never go there; these helpers are what make the write legal.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = html.indexOf('function _attachLinkedRecalls(');
const b = html.indexOf('// Called after a scan is saved. Checks all active recalls', a);
if (a < 0 || b < 0) throw new Error('helper markers not found in index.html');
const { _attachLinkedRecalls, _pushedMatchRecallId } = new Function(
  html.slice(a, b) + '; return { _attachLinkedRecalls, _pushedMatchRecallId };'
)();

const EV = 'ev-1';
const pushed = () => ({ id: EV, product_name: 'Peanut butter', lot_number: 'L1', source: 'manufacturer_push' });

test('attach: linked rows are grouped under their event; manual rows are ignored', () => {
  const rows = [
    { id: 'r-manual', lot_number: 'M1', recall_event_id: null, is_pushed: false },
    { id: 'r-l1', lot_number: 'L1', recall_event_id: EV, is_pushed: true },
    { id: 'r-l2', lot_number: 'L2', recall_event_id: EV, is_pushed: true },
    { id: 'r-other', lot_number: 'X', recall_event_id: 'ev-2', is_pushed: true },
  ];
  const [p, q] = _attachLinkedRecalls([pushed(), { id: 'ev-3', source: 'manufacturer_push' }], rows);
  assert.deepEqual(p._linkedRecalls.map(l => l.id), ['r-l1', 'r-l2']);
  assert.deepEqual(q._linkedRecalls, [], 'an event with no linked row gets an empty list');
});

test('attach: tolerates a failed recalls query (null rows)', () => {
  const [p] = _attachLinkedRecalls([pushed()], null);
  assert.deepEqual(p._linkedRecalls, []);
});

test('pick: one linked row is used whatever the scan carries', () => {
  const [p] = _attachLinkedRecalls([pushed()], [{ id: 'r-l1', lot_number: 'L1', recall_event_id: EV }]);
  assert.equal(_pushedMatchRecallId(p, { raw_capture: 'SOMETHING ELSE' }), 'r-l1');
});

test('pick: with several lots, the lot the scan carries wins (raw_capture, case-insensitive)', () => {
  const [p] = _attachLinkedRecalls([pushed()], [
    { id: 'r-l1', lot_number: 'L1A', recall_event_id: EV },
    { id: 'r-l2', lot_number: 'L2B', recall_event_id: EV },
  ]);
  assert.equal(_pushedMatchRecallId(p, { raw_capture: '(01)00812345000016(10)l2b(17)271231' }), 'r-l2');
  assert.equal(_pushedMatchRecallId(p, { lot_number: 'L1A', raw_capture: null }), 'r-l1', 'lot_number is the fallback field');
});

test('pick: with several lots and a barcode-only scan, the barcode decides', () => {
  const [p] = _attachLinkedRecalls([pushed()], [
    { id: 'r-l1', lot_number: 'L1A', barcode_number: '111', recall_event_id: EV },
    { id: 'r-l2', lot_number: 'L2B', barcode_number: '222', recall_event_id: EV },
  ]);
  assert.equal(_pushedMatchRecallId(p, { barcode_number: '222' }), 'r-l2');
});

test('pick: no lot or barcode agreement falls back to the first linked row', () => {
  const [p] = _attachLinkedRecalls([pushed()], [
    { id: 'r-l1', lot_number: 'L1A', recall_event_id: EV },
    { id: 'r-l2', lot_number: 'L2B', recall_event_id: EV },
  ]);
  assert.equal(_pushedMatchRecallId(p, { raw_capture: 'ZZZ' }), 'r-l1');
});

test('pick: no linked row means no match row can be written', () => {
  assert.equal(_pushedMatchRecallId({ id: EV, _linkedRecalls: [] }, { raw_capture: 'L1' }), null);
  assert.equal(_pushedMatchRecallId({ id: EV }, { raw_capture: 'L1' }), null, 'a recall built before attach has no list');
  assert.equal(_pushedMatchRecallId(null, {}), null);
});
