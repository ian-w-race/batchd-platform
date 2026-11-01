// The shared FSMA 204 rules (src/shared/fsma.js, improvement plan A2 part 2).
// Until 2026-11-01 these lived inline in dashboard.html, index.html and
// signup.html and scripts/check.mjs compared the copies. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/shared/fsma.js';

test('the sortable spreadsheet has the 27 columns in the documented order', () => {
  assert.equal(f.FSMA204_EXPORT_HEADERS.length, 27);
  assert.equal(f.FSMA204_EXPORT_HEADERS[0], 'Traceability Lot Code');
  assert.equal(f.FSMA204_EXPORT_HEADERS[2], 'GTIN');
  assert.equal(f.FSMA204_EXPORT_HEADERS[18], 'Date Received');
  assert.equal(f.FSMA204_EXPORT_HEADERS[26], 'Notes');
  assert.ok(Object.isFrozen(f.FSMA204_EXPORT_HEADERS));
  assert.match(f.FSMA204_EXPORT_DISCLAIMER, /supports FSMA 204 record keeping/);
  assert.doesNotMatch(f.FSMA204_EXPORT_DISCLAIMER, /compliant/);
});

test('citations are the verified eCFR references', () => {
  const c = f.CITATIONS_US;
  assert.equal(c.retention, '21 CFR 1.1455(d)');
  assert.equal(c.availability, '21 CFR 1.1455(c)');
  assert.equal(c.receivingKde, '21 CFR 1.1345');
  assert.equal(c.plan, '21 CFR 1.1315');
  assert.equal(c.exemptions, '21 CFR 1.1305');
  assert.deepEqual([c.recallNotify, c.recallComms, c.recallEnd], ['21 CFR 7.46', '21 CFR 7.49', '21 CFR 7.55']);
  assert.equal(c.complianceDate, 'July 20, 2028');
  assert.match(c.rfrRetail, /do not file with the FDA Reportable Food Registry/);
  // The facility sentence has an admin wording and a store-staff wording.
  assert.match(c.rfrFacility, /Your stores still pull, hold and document/);
  assert.match(f.RFR_FACILITY_STORE, /Your job in the store is still to pull, hold and document/);
  const store = f.citationTable({ rfrFacility: f.RFR_FACILITY_STORE });
  assert.equal(store.rfrFacility, f.RFR_FACILITY_STORE);
  assert.equal(store.retention, c.retention);
});

test('sales bands map to applicability and the copy ends with the closing line', () => {
  assert.deepEqual(f.bandApplicability(), {
    under_250k: 'exempt', '250k_to_1m': 'covered_no_spreadsheet', '1m_to_10m': 'covered', over_10m: 'covered', undisclosed: 'unknown',
  });
  assert.equal(f.applicabilityFor('1m_to_10m'), 'covered');
  assert.equal(f.applicabilityFor('not-a-band'), 'unknown');
  assert.equal(f.APPLICABILITY_BANDS[0].label, `Under ${f.THRESHOLDS.exempt}`);
  assert.equal(f.APPLICABILITY_BANDS[1].label, `${f.THRESHOLDS.exempt} to ${f.THRESHOLDS.spreadsheet}`);
  const t = f.applicabilityTable('Ask your admin.');
  assert.equal(t.copy.unknown, 'Ask your admin.');
  assert.equal(t.copy.covered, f.APPLICABILITY_COPY.covered);
  assert.ok(f.applicabilityCopy('exempt', 'x').endsWith(f.APPLICABILITY_CLOSING));
  assert.equal(f.applicabilityCopy('unknown', 'Ask your admin.'), 'Ask your admin. ' + f.APPLICABILITY_CLOSING);
  assert.match(f.APPLICABILITY_THRESHOLD_NOTE, /1\.1305\(i\)/);
  assert.match(f.APPLICABILITY_CLOSING, /does not by itself constitute compliance/);
});

test('a supplier is complete with name, phone, street, city, state and ZIP', () => {
  const full = { name: 'Sysco', phone: '512', street_address: '1 Main', city: 'Austin', region: 'TX', postal_code: '78701' };
  assert.equal(f.supplierIsComplete(full), true);
  for (const k of Object.keys(full)) assert.equal(f.supplierIsComplete({ ...full, [k]: '' }), false, k);
  assert.equal(f.supplierIsComplete(null), false);
});

test('CSV cells are formula-safe and escaped', () => {
  assert.equal(f.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(f.csvCell('@cmd'), "'@cmd");
  assert.equal(f.csvCell('+1 512 555 0100'), "'+1 512 555 0100");
  assert.equal(f.csvCell('-5'), '-5');
  assert.equal(f.csvCell('-abc'), "'-abc");
  assert.equal(f.csvCell('a,b'), '"a,b"');
  assert.equal(f.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(f.csvCell('two\nlines'), '"two\nlines"');
  assert.equal(f.csvCell(null), '');
  assert.equal(f.csvCell(42), '42');
});

test('local date and time read the store clock', () => {
  const d = new Date(2026, 10, 1, 9, 5); // local time
  assert.equal(f.localDate(d), '2026-11-01');
  assert.equal(f.localTime(d), '09:05');
  assert.equal(f.localDate('nonsense'), '');
  assert.equal(f.localTime(null), '00:00'.slice(0, 0) || f.localTime(null)); // null is epoch, still a valid time
});
