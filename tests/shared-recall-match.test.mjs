// The shared recall matcher (src/shared/recall-match.js, improvement plan A2
// part 3). Encodes CLAUDE.md's rule: a recall requires action on an exact lot
// or barcode match; a product-only match is a warning. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallMatchLevel, checkRecordAgainstRecalls, fuzzyProductMatch, levenshtein } from '../src/shared/recall-match.js';

const scan = (o) => ({ id: 's1', product_name: 'Creamy peanut butter 16 oz', raw_capture: 'PB24105 BEST BY 03/01/2027', lot_number: 'PB24105 BEST BY 03/01/2027', barcode_number: null, ...o });
const recall = (o) => ({ id: 'r1', product_name: 'Creamy Peanut Butter 16 oz', lot_number: 'PB24105', barcode_number: null, ...o });

test('the recall lot inside the raw capture is an exact match', () => {
  const r = recallMatchLevel(scan(), recall());
  assert.equal(r.level, 'exact');
  assert.equal(r.matched_on, 'substring');
});

test('a barcode match is exact even when the product names differ', () => {
  const r = recallMatchLevel(scan({ barcode_number: '0081234500016', product_name: 'Something else' }), recall({ barcode_number: '0081234500016', lot_number: null }));
  assert.equal(r.level, 'exact');
  assert.equal(r.matched_on, 'barcode');
});

test('the same product with another lot is only a possible match', () => {
  const r = recallMatchLevel(scan({ raw_capture: 'PB24199', lot_number: 'PB24199' }), recall());
  assert.equal(r.level, 'possible');
  assert.equal(r.matched_on, 'product_name_only');
});

test('an unrelated product with no identifier hit is no match', () => {
  assert.equal(recallMatchLevel(scan({ product_name: 'Whole milk 1 gal', raw_capture: 'X1', lot_number: 'X1' }), recall()).level, null);
});

test('a short lot code needs the product to corroborate', () => {
  const short = recall({ lot_number: 'A1' });
  assert.equal(recallMatchLevel(scan({ product_name: 'Whole milk', raw_capture: 'A1Z', lot_number: 'A1Z' }), short).level, null);
  assert.equal(recallMatchLevel(scan({ raw_capture: 'A1Z', lot_number: 'A1Z' }), short).level, 'exact');
});

test('long feed descriptions never match on product name alone', () => {
  const long = recall({ product_name: 'Example Nut Co. recalls Creamy Peanut Butter 16 oz jars because they may be contaminated with Salmonella, FDA notified', lot_number: null });
  assert.equal(recallMatchLevel(scan(), long).level, null);
  assert.equal(fuzzyProductMatch(long.product_name, 'Creamy peanut butter'), false);
});

test('the log callback is called with the outcome and the highest level wins over a list', () => {
  const calls = [];
  const log = (s, r, type, on) => calls.push([type, on]);
  const level = checkRecordAgainstRecalls(scan(), [recall({ id: 'other', product_name: 'Whole milk', lot_number: 'ZZZZ' }), recall()], log);
  assert.equal(level, 'exact');
  assert.deepEqual(calls, [['none', null], ['red', 'substring']]);
  assert.equal(checkRecordAgainstRecalls(scan({ raw_capture: 'Q', lot_number: 'Q' }), [recall()]), 'possible');
});

test('levenshtein counts edits', () => {
  assert.equal(levenshtein('lot', 'lot'), 0);
  assert.equal(levenshtein('lot', 'lots'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});
