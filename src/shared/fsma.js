// src/shared/fsma.js
// The FSMA 204 rules both apps and signup share, once (improvement plan A2
// part 2, 2026-11-01). Before this they were copied by hand into
// dashboard.html, index.html and signup.html and scripts/check.mjs compared
// the copies. Bundled into /assets/batchd-shared.js by scripts/build.mjs and
// exposed as window.Batchd.fsma; the pages keep their old names as thin
// aliases. Regulatory text here must match the eCFR; see CLAUDE.md,
// "FSMA 204 build: where things live".

// US citations. Retention is 21 CFR 1.1455(d), availability 1.1455(c),
// receiving KDEs 1.1345, plan 1.1315, exemptions 1.1305, recall 7.46, 7.49,
// 7.55. rfrRetail is shown to a retail store, rfrFacility to an organization
// that operates a registered facility (organisations.operates_registered_facility).
export const CITATIONS_US = Object.freeze({
  rule: "FSMA 204",
  subpart: "21 CFR Part 1 Subpart S",
  plan: "21 CFR 1.1315",
  receivingKde: "21 CFR 1.1345",
  availability: "21 CFR 1.1455(c)",
  retention: "21 CFR 1.1455(d)",
  exemptions: "21 CFR 1.1305",
  recallNotify: "21 CFR 7.46",
  recallComms: "21 CFR 7.49",
  recallEnd: "21 CFR 7.55",
  complianceDate: "July 20, 2028",
  rfrRetail: "Retail stores do not file with the FDA Reportable Food Registry; that duty belongs to registered facilities. For a recall in progress, the recalling firm notifies the FDA district recall coordinator (21 CFR 7.46). Your job is to pull, hold and document.",
  rfrFacility: "Your organization operates a registered facility, so the Reportable Food Registry applies to it: a registered facility reports within 24 hours of determining that a food is a reportable food (FD&C Act section 417). Your stores still pull, hold and document, and for a recall in progress the recalling firm notifies the FDA district recall coordinator (21 CFR 7.46).",
});
// The same sentence worded for store staff (the scanner's FSMA tab and recall
// sheet); the dashboard's wording above speaks to the corporate admin.
export const RFR_FACILITY_STORE = "Your organization operates a registered facility, so the Reportable Food Registry applies to it: a registered facility reports within 24 hours of determining that a food is a reportable food (FD&C Act section 417). Your job in the store is still to pull, hold and document; for a recall in progress the recalling firm notifies the FDA district recall coordinator (21 CFR 7.46).";
// A page's citation table: CITATIONS_US with per-surface wording overrides.
export function citationTable(overrides) {
  return Object.freeze(Object.assign({}, CITATIONS_US, overrides || {}));
}

// Dollar thresholds of the retail food establishment exemption, 21 CFR
// 1.1305(i), and the sortable-spreadsheet exemption, 21 CFR 1.1455(c)(3)(iii):
// average annual monetary value of food sold over the previous 3 years,
// 2020 dollars. The FDA has not published inflation-adjusted figures for this
// rule yet; when it does, change them here and nowhere else.
export const THRESHOLDS = Object.freeze({ exempt: '$250,000', spreadsheet: '$1 million', upper: '$10 million' });

// Annual food sales bands (organisations.annual_food_sales_band) and what each
// means for FSMA 204 applicability.
export const APPLICABILITY_BANDS = Object.freeze([
  Object.freeze({ key: "under_250k", label: "Under $250,000", applicability: "exempt" }),
  Object.freeze({ key: "250k_to_1m", label: "$250,000 to $1 million", applicability: "covered_no_spreadsheet" }),
  Object.freeze({ key: "1m_to_10m", label: "$1 million to $10 million", applicability: "covered" }),
  Object.freeze({ key: "over_10m", label: "Over $10 million", applicability: "covered" }),
  Object.freeze({ key: "undisclosed", label: "Prefer not to say", applicability: "unknown" }),
]);
export const APPLICABILITY_LABELS = Object.freeze({"exempt":"Likely exempt","covered_no_spreadsheet":"Covered, no spreadsheet duty","covered":"Covered","unknown":"Not yet answered"});
// The three settled states read the same on every surface. The "unknown" line
// differs by who is reading (admin in Settings, signup, store staff), so each
// page passes its own through applicabilityTable().
export const APPLICABILITY_COPY = Object.freeze({
  exempt: "Based on your sales band, your store is likely exempt from the FSMA 204 record-keeping requirements. Lot-level receiving records still cut recall time and protect you if a supplier's records are wrong, which is why Batch'd keeps them anyway.",
  covered_no_spreadsheet: "Your store is covered by FSMA 204 and must keep receiving records and a traceability plan, and still has to make records available within 24 hours of an FDA request, but is not required to produce them as an electronic sortable spreadsheet. Batch'd produces the spreadsheet anyway so the request is a one-click answer.",
  covered: "Your store is covered by FSMA 204. Receiving records, a traceability plan and the ability to produce a sortable spreadsheet within 24 hours are required from July 20, 2028.",
});
export const APPLICABILITY_CLOSING = "Batch'd supports FSMA 204 record keeping. It does not by itself constitute compliance.";
export const APPLICABILITY_THRESHOLD_NOTE = "Bands follow 21 CFR 1.1305(i) ($250,000, exempt) and 1.1455(c)(3)(iii) ($1 million, no electronic spreadsheet duty): average annual food sales over the previous three years, in 2020 dollars adjusted for inflation. The FDA had not published adjusted figures for this rule as of May 2026, so the bands use the amounts as written.";

// band key -> applicability ('exempt' | 'covered_no_spreadsheet' | 'covered' | 'unknown')
export function applicabilityFor(band) {
  const b = APPLICABILITY_BANDS.find((x) => x.key === band);
  return (b && b.applicability) || 'unknown';
}
// { under_250k: 'exempt', ... } as signup.html reads it
export function bandApplicability() {
  return Object.fromEntries(APPLICABILITY_BANDS.map((b) => [b.key, b.applicability]));
}
// The table a page reads: bands, labels, copy (with that page's own "unknown"
// sentence), closing and threshold note. Same shape as the old per-page objects.
export function applicabilityTable(unknownCopy) {
  return {
    bands: APPLICABILITY_BANDS,
    labels: APPLICABILITY_LABELS,
    copy: Object.assign({}, APPLICABILITY_COPY, { unknown: unknownCopy }),
    closing: APPLICABILITY_CLOSING,
    thresholdNote: APPLICABILITY_THRESHOLD_NOTE,
    thresholds: THRESHOLDS,
  };
}
// The sentence a page shows for an applicability value, with the closing line.
export function applicabilityCopy(app, unknownCopy) {
  return (APPLICABILITY_COPY[app] || unknownCopy) + ' ' + APPLICABILITY_CLOSING;
}

// Completeness rule for a supplier as the immediate previous source
// (21 CFR 1.1345): name, phone, street, city, state, ZIP. Shared by the
// dashboard (supplierIsComplete) and the scanner (_rcvSupplierComplete).
export function supplierIsComplete(s) {
  return !!(s && s.name && s.phone && s.street_address && s.city && s.region && s.postal_code);
}

// The sortable spreadsheet (21 CFR 1.1455(c)(3)): 27 columns, identical in
// the dashboard export, the scanner export and the records request drill.
export const FSMA204_EXPORT_HEADERS = Object.freeze([
  "Traceability Lot Code",
  "Product Description",
  "GTIN",
  "Quantity",
  "Unit of Measure",
  "Immediate Previous Source: Business Name",
  "Immediate Previous Source: Phone",
  "Immediate Previous Source: Address",
  "Immediate Previous Source: City",
  "Immediate Previous Source: State",
  "Immediate Previous Source: Zip",
  "Immediate Previous Source: Country",
  "Receiving Location: Business Name",
  "Receiving Location: Phone",
  "Receiving Location: Address",
  "Receiving Location: City",
  "Receiving Location: State",
  "Receiving Location: Zip",
  "Date Received",
  "Time Received (local)",
  "TLC Source Type",
  "TLC Source Reference",
  "Reference Document Type",
  "Reference Document Number",
  "FTL Category",
  "Record ID",
  "Notes",
]);
export const FSMA204_EXPORT_DISCLAIMER = "Prepared with Batch'd. Batch'd supports FSMA 204 record keeping; the responsibility for the records remains with the business.";

// One CSV cell: a leading =, @ or + (phone numbers too) is quoted so a
// spreadsheet does not run it as a formula; a leading minus is quoted only
// when a letter or bracket follows (negative numbers stay plain); quotes,
// commas and line breaks are escaped. Used by every CSV the apps write.
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  const safe = /^[=@+]|^-\s*[A-Za-z(]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
// Local calendar date and clock time of a timestamp for the export (the
// store's own time zone, as the rule reads "Date Received").
export function localDate(d) { const dt = new Date(d); const pad = (n) => String(n).padStart(2, '0'); return isNaN(dt) ? '' : dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
export function localTime(d) { const dt = new Date(d); const pad = (n) => String(n).padStart(2, '0'); return isNaN(dt) ? '' : pad(dt.getHours()) + ':' + pad(dt.getMinutes()); }
