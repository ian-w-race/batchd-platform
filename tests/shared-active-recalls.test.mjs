// The one list of active recalls (src/shared/active-recalls.js, improvement
// plan B4 stage 4): the rows batchd_active_recalls returns become the shape
// the scanner caches, and the shared rules every reader applies.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActiveRecalls, exactIdentifierHit, matchIdColumns, recallLots, recallBarcodes } from '../src/shared/active-recalls.js';
import { recallMatchLevel } from '../src/shared/recall-match.js';

const ROWS = [
  { kind: 'manual', recall_id: 'r-1', event_id: null, catalog_id: null, product_name: 'Creamy peanut butter 16 oz', lot_number: 'PB24105', lots: ['PB24105'], barcode: '0081234500016', gtins: [], description: 'Salmonella', reason: 'Salmonella', severity: null, source: 'manual', published_at: '2026-11-01T10:00:00Z', recalling_firm: null, dismissed: false, matched: true },
  { kind: 'pushed', recall_id: null, event_id: 'ev-1', catalog_id: null, product_name: 'Romaine hearts 3 ct', lot_number: 'L1A, L2B', lots: ['L1A', 'L2B'], barcode: null, gtins: [], description: 'Possible E. coli', reason: 'Possible E. coli', severity: 'class_i', source: 'manufacturer_push', published_at: '2026-11-02T10:00:00Z', recalling_firm: 'Batch\'d Admin', dismissed: false, matched: false },
  { kind: 'feed', recall_id: null, event_id: null, catalog_id: 'c-1', product_name: 'Holsum Spinach Flour Tortillas Large, 8 count', lot_number: '26210', lots: ['26210', '26250'], barcode: null, gtins: ['041497036119'], description: 'Undeclared wheat [F-1234-2026]', reason: 'Undeclared wheat', severity: 'class_ii', source: 'fda', published_at: '2026-10-30T00:00:00Z', recalling_firm: 'Holsum', dismissed: false, matched: false },
  { kind: 'feed', recall_id: null, event_id: null, catalog_id: 'c-2', product_name: 'Dismissed product', lot_number: null, lots: [], barcode: null, gtins: [], description: null, reason: null, severity: null, source: 'fda', published_at: null, recalling_firm: null, dismissed: true, matched: false },
];

test('normalize: one cache object per row, keyed by the id of its kind, dismissed feed entries left out', () => {
  const out = normalizeActiveRecalls(ROWS);
  assert.deepEqual(out.map((r) => [r.id, r._kind]), [['r-1', 'manual'], ['ev-1', 'pushed'], ['c-1', 'feed']]);
  assert.equal(normalizeActiveRecalls(ROWS, { includeDismissed: true }).length, 4);
  for (const r of out) {
    assert.equal(r.active, true);
    assert.deepEqual(r._linkedRecalls, [], 'the linked rows are attached later by the page');
  }
});

test('normalize: the cache shape the scanner has always read', () => {
  const [manual, pushed, feed] = normalizeActiveRecalls(ROWS);
  assert.equal(manual.barcode_number, '0081234500016', 'barcode becomes barcode_number');
  assert.equal(manual._matched, true);
  assert.equal(pushed.lot_number, 'L1A, L2B', 'a pushed recall keeps its typed list for display');
  assert.deepEqual(pushed.lots, ['L1A', 'L2B'], 'and every lot for matching');
  assert.equal(pushed.source, 'manufacturer_push');
  assert.equal(pushed.description, 'Possible E. coli');
  assert.equal(feed.lot_number, '26210', 'a feed entry shows its first parsed lot');
  assert.deepEqual(feed.gtins, ['041497036119']);
  assert.equal(feed.description, 'Undeclared wheat [F-1234-2026]', 'the recall number stays at the end of the description');
  assert.equal(feed.severity, 'class_ii');
});

test('normalize: tolerates null, rows without an id, and duplicates', () => {
  assert.deepEqual(normalizeActiveRecalls(null), []);
  assert.deepEqual(normalizeActiveRecalls([{ kind: 'feed', catalog_id: null }, null, { kind: 'other', recall_id: 'x' }]), []);
  assert.equal(normalizeActiveRecalls([ROWS[0], ROWS[0]]).length, 1);
});

test('lots and barcodes: the lists fall back to the single fields', () => {
  assert.deepEqual(recallLots({ lot_number: ' AB12 ', lots: [] }), ['ab12']);
  assert.deepEqual(recallLots({ lot_number: 'L1A, L2B', lots: ['L1A', 'L2B'] }), ['l1a', 'l2b']);
  assert.deepEqual(recallBarcodes({ barcode_number: '111', gtins: ['222', ''] }), ['111', '222']);
  assert.deepEqual(recallLots(null), []);
});

test('exact identifier hit: equal lot or equal barcode, over every lot and GTIN, nothing looser', () => {
  const [manual, pushed, feed] = normalizeActiveRecalls(ROWS);
  assert.equal(exactIdentifierHit({ lot_number: 'pb24105' }, manual), true);
  assert.equal(exactIdentifierHit({ lot_number: 'PB24105 BEST BY 03/01/2027' }, manual), false, 'no substring in the strict rule');
  assert.equal(exactIdentifierHit({ barcode_number: '0081234500016', product_name: 'Other' }, manual), true);
  assert.equal(exactIdentifierHit({ lot_number: 'L2B' }, pushed), true, 'the second lot of a pushed recall counts');
  assert.equal(exactIdentifierHit({ lot_number: '26250' }, feed), true);
  assert.equal(exactIdentifierHit({ barcode_number: '041497036119' }, feed), true, 'a GTIN counts as a barcode');
  assert.equal(exactIdentifierHit({ product_name: 'Holsum Spinach Flour Tortillas Large, 8 count' }, feed), false);
  assert.equal(exactIdentifierHit({}, feed), false);
  assert.equal(exactIdentifierHit(null, feed), false);
});

test('match id columns: manual, pushed (linked row required) and feed', () => {
  const [manual, pushed, feed] = normalizeActiveRecalls(ROWS);
  assert.deepEqual(matchIdColumns(manual), { recall_id: 'r-1', recall_event_id: null, catalog_id: null });
  assert.deepEqual(matchIdColumns(pushed, 'r-l2'), { recall_id: 'r-l2', recall_event_id: 'ev-1', catalog_id: null });
  assert.equal(matchIdColumns(pushed, null), null, 'a pushed recall without a linked row gets no match row');
  assert.deepEqual(matchIdColumns(feed), { recall_id: null, recall_event_id: null, catalog_id: 'c-1' });
  assert.deepEqual(matchIdColumns({ id: 'r-9', source: 'manual' }), { recall_id: 'r-9', recall_event_id: null, catalog_id: null }, 'a cache entry a writer pushed without _kind is manual');
  assert.equal(matchIdColumns({ id: 'ev-9', source: 'manufacturer_push' }, null), null);
  assert.equal(matchIdColumns(null), null);
});

test('matcher: a pushed recall with several lots matches a scan of its second lot (the 2026-11 defect)', () => {
  const [, pushed] = normalizeActiveRecalls(ROWS);
  const scan = { id: 's1', product_name: 'Romaine hearts 3 ct', raw_capture: '(01)00812345000016(10)L2B(17)271231', lot_number: '(01)00812345000016(10)L2B(17)271231', barcode_number: null };
  const r = recallMatchLevel(scan, pushed);
  assert.equal(r.level, 'exact');
  assert.equal(r.matched_on, 'substring');
  assert.equal(r.matched_lot, 'l2b');
});

test('matcher: a feed entry matches on a parsed lot or a GTIN', () => {
  const [, , feed] = normalizeActiveRecalls(ROWS);
  assert.equal(recallMatchLevel({ product_name: 'Tortillas', raw_capture: 'LOT 26250 BB 12/26', lot_number: 'LOT 26250 BB 12/26' }, feed).level, 'exact');
  assert.equal(recallMatchLevel({ product_name: 'Tortillas', raw_capture: null, lot_number: null, barcode_number: '041497036119' }, feed).matched_on, 'barcode');
  assert.equal(recallMatchLevel({ product_name: 'Whole milk', raw_capture: 'X9', lot_number: 'X9' }, feed).level, null);
});
