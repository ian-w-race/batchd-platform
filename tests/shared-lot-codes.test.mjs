// The recall code parser (src/shared/lot-codes.cjs, improvement plan B5
// stage 1): what a store can match on, read out of the FDA's free text. The
// fixtures are the shapes the production catalog held on 2026-11-08.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseRecallCodes, parseDateToken, lotInRange, findRangeHit, PARSER_VERSION } = require('../src/shared/lot-codes.cjs');

const parse = (code_info, product_description = '', more_code_info = '') => parseRecallCodes({ code_info, more_code_info, product_description });

test('parser version is 2', () => { assert.equal(PARSER_VERSION, 2); });

test('dates: US month-first numeric, month names, a month alone', () => {
  assert.deepEqual(parseDateToken('8/21/2026'), { from: '2026-08-21', to: '2026-08-21' });
  assert.deepEqual(parseDateToken('10/14/26'), { from: '2026-10-14', to: '2026-10-14' });
  assert.deepEqual(parseDateToken('July 28, 2026'), { from: '2026-07-28', to: '2026-07-28' });
  assert.deepEqual(parseDateToken('Feb.10.27'), { from: '2027-02-10', to: '2027-02-10' });
  assert.deepEqual(parseDateToken('26 SEP 2026'), { from: '2026-09-26', to: '2026-09-26' });
  assert.deepEqual(parseDateToken('2026-12-31'), { from: '2026-12-31', to: '2026-12-31' });
  assert.deepEqual(parseDateToken('01/2027'), { from: '2027-01-01', to: '2027-01-31' });
  assert.equal(parseDateToken('13/45/2026'), null, 'an impossible date is not a date');
  assert.equal(parseDateToken('2027'), null, 'a bare year is not a window');
  assert.deepEqual(parseDateToken('July 2029'), { from: '2029-07-01', to: '2029-07-31' }, 'a month and year is the month, not July 20, 2029');
  assert.deepEqual(parse('Lots: 720106. Best if used by: July 2029.'), { lots: ['720106'], lot_ranges: [], gtins: [], best_by_from: '2029-07-01', best_by_to: '2029-07-31', all_lots: false, parser_version: 2 });
});

test('best-by labels make the window; the earliest and latest date bound it', () => {
  assert.deepEqual(parse('Best By Date: 8/21/2026').best_by_from, '2026-08-21');
  const r = parse('Exp: 10/14/26');
  assert.equal(r.best_by_from, '2026-10-14'); assert.equal(r.best_by_to, '2026-10-14'); assert.deepEqual(r.lots, []);
  const w = parse('Best By 11/01/2026 through 12/15/2026');
  assert.equal(w.best_by_from, '2026-11-01'); assert.equal(w.best_by_to, '2026-12-15');
  assert.deepEqual(w.lot_ranges, [], 'a date range is not a lot range');
  const u = parse('USE BY: 10/19/2027');
  assert.equal(u.best_by_from, '2027-10-19');
  const e = parse('Expiration Date: July 28,2026');
  assert.equal(e.best_by_from, '2026-07-28');
  const two = parse('Lot No: TS-633-2 Use By: 12/31/2029');
  assert.deepEqual(two.lots, ['TS-633-2']); assert.equal(two.best_by_from, '2029-12-31');
  assert.equal(parse('Packed for 2027').best_by_from, null, 'a packing year is not a best-by window');
  assert.equal(parse('Dates of Manufacture: 04/29/2026').best_by_from, null, 'a manufacture date is not a best-by date');
});

test('GTINs and UPCs from the code text and the product text', () => {
  assert.deepEqual(parse('UPC 0 41497 03611 9, Lot codes 2024-07 and 2024-08').gtins, ['041497036119']);
  assert.deepEqual(parse('lot: 6156', 'Jovy Gummy Worms Neon; packaged in 1lb plastic units. UPC 712199083411').gtins, ['712199083411']);
  assert.deepEqual(parse('Item 00812345000016 lot PB24105 through PB24150').gtins, ['00812345000016']);
  assert.deepEqual(parse('(01)00812345000016(10)L2B').gtins, ['00812345000016']);
  assert.deepEqual(parse('UPC: 8 12345 00001 6').gtins, ['812345000016']);
  assert.deepEqual(parse('Lot 594886001').gtins, [], 'a nine-digit lot is not a GTIN');
});

test('lot ranges are kept as printed, with matching prefix and digit count', () => {
  const r = parse('Item 00812345000016 lot PB24105 through PB24150');
  assert.deepEqual(r.lot_ranges, [{ from: 'PB24105', to: 'PB24150' }]);
  assert.deepEqual(r.lots, ['PB24105', 'PB24150'], 'the end points stay as lots too');
  assert.deepEqual(parse('Lots 24100 thru 24150').lot_ranges, [{ from: '24100', to: '24150' }]);
  assert.deepEqual(parse('Lot codes A1001 - A1009').lot_ranges, [{ from: 'A1001', to: 'A1009' }]);
  assert.deepEqual(parse('108-728-420').lot_ranges, [], 'a hyphenated lot code is one code');
  assert.deepEqual(parse('108-728-420').lots, ['108-728-420']);
  assert.deepEqual(parse('Lots AB100 through CD200').lot_ranges, [], 'different prefixes are not a range');
  assert.deepEqual(parse('Lot 100 to 1000').lot_ranges, [], 'different digit counts are not a range');
});

test('lot codes: labeled first, then any plausible token; dates, years and GTINs excluded', () => {
  assert.deepEqual(parse('Lot #: L24201, L24202; Best By 12/15/2026').lots, ['L24201', 'L24202']);
  assert.deepEqual(parse('Lot Code(s): 26J000059879-01  Dates of Manufacture: 04/29/2026').lots, ['26J000059879-01']);
  assert.deepEqual(parse('" Lot Number: 594886001 MFG 1125, printed on side label. " Affected units only: ').lots, ['594886001']);
  assert.deepEqual(parse('Lot #22, 020528 Expiration').lots, ['020528']);
  assert.deepEqual(parse('AA051526').lots, ['AA051526']);
  assert.deepEqual(parse('Lot Numbers: GC26257, GC26270, GC26288, ').lots, ['GC26257', 'GC26270', 'GC26288']);
  assert.deepEqual(parse('Batch: CS00140785; Expiry Date: 26 SEP 2026').lots, ['CS00140785']);
  assert.deepEqual(parse('Lot: AUG172026').lots, ['AUG172026'], 'a date-coded lot after "Lot" stays a lot');
  assert.deepEqual(parse('best by Feb.10.27').lots, [], 'an unlabeled date is a date');
  assert.deepEqual(parse('Best by 2026, lot 26187 and 2576').lots, ['26187', '2576'], 'after "lot", a four-digit number is a lot');
  assert.deepEqual(parse('Shipped 2026, 2576 units').lots, [], 'without a label a short number is a year or a count');
  assert.deepEqual(parse('All lots. Exp 01/2027').lots, []);
  assert.deepEqual(parse('').lots, []);
  assert.deepEqual(parse(null).lots, []);
  const many = parse(Array.from({ length: 80 }, (_, i) => 'LOT' + (1000 + i)).join(', '));
  assert.equal(many.lots.length, 50, 'capped at 50');
});

test('"all lots", "no codes" and "not coded" set the flag', () => {
  assert.equal(parse('All lots. Exp 01/2027').all_lots, true);
  assert.equal(parse('All Lots and Varieties').all_lots, true);
  assert.equal(parse('No codes').all_lots, true);
  assert.equal(parse('no lot code').all_lots, true);
  assert.equal(parse('Product is not coded').all_lots, true);
  assert.equal(parse('Lot 26187').all_lots, false);
  assert.equal(parse('All product with Best By dates through 12/31/2026').all_lots, true);
  assert.equal(parse('none').all_lots, true); assert.equal(parse('None').all_lots, true);
  assert.equal(parse('no lot number').all_lots, true);
  assert.equal(parse('Will be provided by firm').all_lots, true);
  assert.equal(parse('Packed for 2027').all_lots, false, 'a packing year is not a statement about codes');
});

test('a whole entry: the openFDA sample row', () => {
  const r = parse('lot: 6156', 'Jovy Gummy Worms Neon; packaged in 1lb plastic units. UPC 712199083411', '');
  assert.deepEqual(r, { lots: ['6156'], lot_ranges: [], gtins: ['712199083411'], best_by_from: null, best_by_to: null, all_lots: false, parser_version: 2 });
});

test('lotInRange and findRangeHit', () => {
  const range = { from: 'PB24105', to: 'PB24150' };
  assert.equal(lotInRange('PB24120', range), true);
  assert.equal(lotInRange('pb24150', range), true, 'case-insensitive prefix');
  assert.equal(lotInRange('PB24151', range), false);
  assert.equal(lotInRange('PB2412', range), false, 'different digit count');
  assert.equal(lotInRange('XB24120', range), false);
  assert.equal(findRangeHit('(01)00812345000016(10)PB24120(17)271231', range), 'PB24120');
  assert.equal(findRangeHit('PB24099 BEST BY 03/01/2027', range), null);
  assert.equal(findRangeHit('ABPB24120', range), null, 'the code must start at a boundary');
  assert.equal(findRangeHit('24120', { from: '24100', to: '24150' }), '24120');
  assert.equal(findRangeHit(null, range), null);
});
