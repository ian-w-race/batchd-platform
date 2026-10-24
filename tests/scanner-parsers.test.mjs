// Tests for two pure functions in the scanner (index.html), loaded straight
// from the page so the tests always exercise the shipping code:
//   parseGS1           GS1-128 / DataBar / Digital Link label parser
//   detectFtlCategory  FDA Food Traceability List category from a product name
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (startMarker, endMarker) => {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${startMarker} .. ${endMarker}`);
  return html.slice(a, b);
};

const gs1Code = slice('function parseGS1DigitalLink(raw) {', '// RECEIVING MODE');
const { parseGS1 } = new Function('_userRegion', gs1Code + '; return { parseGS1 };')('us');

const ftlCode = slice('const FTL_CATEGORIES = {', '// Normalise a product name to a stable lookup key.');
const { detectFtlCategory, FTL_CATEGORIES } = new Function(ftlCode + '; return { detectFtlCategory, FTL_CATEGORIES };')();

const FNC1 = String.fromCharCode(29);

test('GS1 human-readable label: GTIN, lot, expiry', () => {
  const r = parseGS1('(01)00012345678905(10)ABC123(17)261231');
  assert.equal(r.gtin, '00012345678905');
  assert.equal(r.lot, 'ABC123');
  assert.equal(r.expiry, '2026-12-31');
  assert.equal(r.bestDate, '2026-12-31');
});

test('GS1 raw with FNC1: a lot that contains "240" is read whole', () => {
  const r = parseGS1(']C1' + '0100012345678905' + '10RM240928' + FNC1 + '17261231');
  assert.equal(r.gtin, '00012345678905');
  assert.equal(r.lot, 'RM240928');
  assert.equal(r.expiry, '2026-12-31');
});

test('GS1 raw without FNC1: the lot stops at the next food-label AI', () => {
  const r = parseGS1('010001234567890510RM24092817261231');
  assert.equal(r.lot, 'RM240928');
  assert.equal(r.expiry, '2026-12-31');
});

test('GS1 raw with FNC1: lot followed by a serial number', () => {
  const r = parseGS1('0100012345678905' + '10LOT-7' + FNC1 + '21SER99');
  assert.equal(r.lot, 'LOT-7');
  assert.equal(r.serial, 'SER99');
});

test('plain EAN-13, UPC-A and GTIN-14 are product codes, never lots', () => {
  for (const code of ['4006381333931', '012345678905', '10012345678902', '96385074']) {
    const r = parseGS1(code);
    assert.equal(r.gtin, code, code);
    assert.equal(r.lot, null, code);
  }
});

test('net weight AIs: 310n is kilograms and 320n is pounds', () => {
  assert.equal(parseGS1('(01)00012345678905(3103)012345').netWeightKg, 12.345);
  assert.equal(parseGS1('(01)00012345678905(3202)001500').netWeightLb, 15);
  const raw = parseGS1(']C1' + '0100012345678905' + '3202001500' + '10L1');
  assert.equal(raw.netWeightLb, 15);
  assert.equal(raw.lot, 'L1');
});

test('dates: best-before, pack date, and day 00', () => {
  const r = parseGS1('(01)00012345678905(13)261001(15)261130(10)X');
  assert.equal(r.packDate, '2026-10-01');
  assert.equal(r.bestBefore, '2026-11-30');
  assert.equal(r.bestDate, '2026-11-30');
  assert.equal(parseGS1('(15)261100').bestBefore, null, 'day 00 means end of month and is not guessed');
});

test('GS1 Digital Link URL: path and query', () => {
  const r = parseGS1('https://id.example.com/01/09506000134352/10/ABC123?17=260101');
  assert.equal(r.gtin, '09506000134352');
  assert.equal(r.lot, 'ABC123');
  assert.equal(r.expiry, '2026-01-01');
});

test('empty input', () => {
  assert.deepEqual(parseGS1(''), { lot: null, batch: null, all: {} });
  assert.deepEqual(parseGS1(null), { lot: null, batch: null, all: {} });
});

const cat = (name) => detectFtlCategory(name).category;

test('listed foods in the two wedge categories are detected', () => {
  assert.equal(cat('Romaine hearts 3 ct'), 'leafy_greens');
  assert.equal(cat('Organic baby spinach 5 oz'), 'leafy_greens');
  assert.equal(cat('Spring mix salad'), cat('Spring mix salad')); // stable
  assert.ok(['nut_butters', 'peanut_butter'].includes(cat('Creamy peanut butter 16 oz')), cat('Creamy peanut butter 16 oz'));
  assert.ok(cat('Almond butter') !== null);
});

test('pepper misfires are excluded, real peppers are listed', () => {
  for (const n of ['Dr Pepper 12 pack', 'Dr. Pepper Zero', 'Pepperoni pizza', 'Peppermint tea', 'Black peppercorn grinder',
                   'Pepper jack cheese', 'Salt and pepper chips', 'Salt & pepper kettle chips']) {
    assert.notEqual(cat(n), 'peppers', n);
  }
  for (const n of ['Red bell peppers', 'Jalapeno peppers', 'Jalapeño', 'Poblano', 'Serrano chiles', 'Habanero']) {
    assert.equal(cat(n), 'peppers', n);
  }
});

test('egg misfires are excluded, shell eggs are listed', () => {
  for (const n of ['Eggplant', 'Eggnog', 'Liquid egg whites', 'Egg roll']) {
    assert.notEqual(cat(n), 'shell_eggs', n);
  }
  assert.equal(cat('Large brown eggs dozen'), 'shell_eggs');
});

test('everyday non-listed products are not flagged', () => {
  for (const n of ['Whole milk 1 gal', 'White bread', 'Cola 2L', 'Paper towels']) {
    assert.equal(detectFtlCategory(n).isFtl, false, n);
  }
});

test('no FTL pattern contains a literal backspace (the old broken \\b defect)', () => {
  for (const [key, c] of Object.entries(FTL_CATEGORIES)) {
    assert.ok(!c.patterns.source.includes('\b'), key);
    if (c.exclude) assert.ok(!c.exclude.source.includes('\b'), key + ' exclude');
  }
});
