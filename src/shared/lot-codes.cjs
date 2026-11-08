// src/shared/lot-codes.cjs
// The recall code parser (improvement plan B5, stage 1, 2026-11-08): what a
// store can match on, read out of the free text a recall carries. One source
// for the importer (CommonJS, so netlify/functions/fetch-recall-feeds.js can
// require it), the browser bundle (src/shared/index.js imports it) and the
// tests. Exposed as window.Batchd.lotCodes.
//
//   parseRecallCodes({ code_info, more_code_info, product_description })
//     -> { lots, lot_ranges, gtins, best_by_from, best_by_to, all_lots, parser_version }
//   lotInRange(lotToken, range)        a whole lot code inside a printed range
//   findRangeHit(rawText, range)       a code inside the range anywhere in a raw capture
//   parseDateToken(text)               one printed date -> { from, to } (ISO), or null
//   PARSER_VERSION                     bump it when a rule changes; the importer
//                                      re-parses older entries a hundred a run
//
// Rules, in the order they apply to the code text:
//   1. "all lots", "all codes", "no codes", "not coded" set all_lots; such a
//      recall matches on GTIN (red) or product only (orange), never red on
//      product alone (Ian, decision 2 of the B5 plan).
//   2. GTINs and UPCs: labeled runs ("UPC 0 41497 03611 9", "UPC: 712199083411")
//      and bare 12 to 14 digit runs, in the code text and the product text,
//      digits only, 8 or 12 to 14 long.
//   3. Best-by dates after a label ("Best By", "Use By", "Exp", "Sell By",
//      "Enjoy By"), US month-first, one date or a printed range; a month alone
//      ("01/2027") is the whole month. The earliest and latest make the window.
//   4. Lot ranges: "PB24105 through PB24150", "24100 to 24150", "A1 - A9" with
//      spaces around the dash; both ends share the letter prefix and the digit
//      count. Stored as printed, never expanded.
//   5. Lot codes: tokens after "Lot", "Lot No", "Lot Code(s)", "Batch", "Code"
//      first (there a bare number of three or four digits counts, "lot: 6156"),
//      then any token of 4 to 30 characters with a digit that is not a date,
//      not a GTIN, not a bare number of four digits or fewer. Capped at 50.
// The FDA text is untrusted data: the parser only ever copies tokens out.

const PARSER_VERSION = 2;
const MAX_LOTS = 50;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const year4 = (y) => (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10));
const validYmd = (y, m, d) => y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

// One printed date. US order for numeric dates (the FDA is a US source).
// Returns { from, to } in ISO, a month alone covering the whole month.
function parseDateToken(text) {
  const t = String(text || '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {                       // 2026-08-21
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? { from: iso(y, mo, d), to: iso(y, mo, d) } : null;
  }
  if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/.exec(t))) {       // 8/21/2026, 10/14/26, 1-5-27
    const y = year4(m[3]), mo = +m[1], d = +m[2];
    return validYmd(y, mo, d) ? { from: iso(y, mo, d), to: iso(y, mo, d) } : null;
  }
  if ((m = /^(\d{1,2})[\/.-](\d{4})$/.exec(t))) {                           // 01/2027 (a month)
    const y = +m[2], mo = +m[1];
    return validYmd(y, mo, 1) ? { from: iso(y, mo, 1), to: iso(y, mo, daysIn(y, mo)) } : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.? ?(\d{4})$/.exec(t))) {                      // July 2029, September 2026 (a month)
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = +m[2];
    return mo && validYmd(y, mo, 1) ? { from: iso(y, mo, 1), to: iso(y, mo, daysIn(y, mo)) } : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.? ?(\d{1,2})(?:st|nd|rd|th)?\.? ?(\d{2}|\d{4})$/.exec(t))) { // July 28 2026, Feb.10.27, Sep 26 2026
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = year4(m[3]), d = +m[2];
    return mo && validYmd(y, mo, d) ? { from: iso(y, mo, d), to: iso(y, mo, d) } : null;
  }
  if ((m = /^(\d{1,2}) ?([A-Za-z]{3,9})\.? ?(\d{2}|\d{4})$/.exec(t))) {       // 26 SEP 2026, 10Sep26
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = year4(m[3]), d = +m[1];
    return mo && validYmd(y, mo, d) ? { from: iso(y, mo, d), to: iso(y, mo, d) } : null;
  }
  return null;
}

// Every date-looking token in a text, as printed, with its position.
// Month-and-year ("July 2029") comes before month-day-year in the alternation,
// so it is not read as July 20, 2029.
const DATE_TOKEN_RE = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}[\/.-]\d{4}|[A-Za-z]{3,9}\.? ?\d{4}(?!\d)|[A-Za-z]{3,9}\.? ?\d{1,2}(?:st|nd|rd|th)?,?\.? ?\d{2,4}|\d{1,2} ?[A-Za-z]{3,9}\.? ?\d{2,4})\b/g;
function dateTokens(text) {
  const out = [];
  let m;
  DATE_TOKEN_RE.lastIndex = 0;
  while ((m = DATE_TOKEN_RE.exec(text))) {
    const parsed = parseDateToken(m[0]);
    if (parsed) out.push({ text: m[0], index: m.index, ...parsed });
  }
  return out;
}

const BEST_BY_LABEL_RE = /\b(best\s*(?:if\s*used\s*)?(?:by|before)|use\s*by|sell\s*by|enjoy\s*by|freshest\s*by|use\s*before|exp(?:iration|ires|iry|\.)?(?:\s*dates?)?|bb\s*dates?|bbd)\b/gi;

function bestByWindow(text) {
  const dates = [];
  let m;
  BEST_BY_LABEL_RE.lastIndex = 0;
  while ((m = BEST_BY_LABEL_RE.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    // Stop at the next label so "Lot 123 Best By 1/2/27 UPC 0..." reads one date group.
    const stopAt = after.search(/\b(lot|batch|upc|gtin|code|item|sku|packed|dates? of|manufactur)/i);
    const span = stopAt >= 0 ? after.slice(0, stopAt) : after;
    for (const d of dateTokens(span)) dates.push(d);
  }
  if (!dates.length) return { from: null, to: null };
  const from = dates.reduce((a, d) => (d.from < a ? d.from : a), dates[0].from);
  const to = dates.reduce((a, d) => (d.to > a ? d.to : a), dates[0].to);
  return { from, to };
}

const GTIN_LABEL_RE = /\b(?:upc|gtin|ean|upc\s*code|upc\s*#|item\s*(?:no|number|#))\s*[:#]?\s*((?:\d[\d\s-]{6,24}\d))/gi;
const GTIN_GS1_RE = /\(01\)\s*(\d{14})/g;
const GTIN_BARE_RE = /(?<![\d-])\d{12,14}(?![\d-])/g;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function gtinsIn(text) {
  const out = new Set();
  let m;
  GTIN_LABEL_RE.lastIndex = 0;
  while ((m = GTIN_LABEL_RE.exec(text))) {
    const digits = m[1].replace(/\D/g, '');
    if (GTIN_LENGTHS.has(digits.length)) out.add(digits);
  }
  GTIN_GS1_RE.lastIndex = 0;
  while ((m = GTIN_GS1_RE.exec(text))) out.add(m[1]);
  GTIN_BARE_RE.lastIndex = 0;
  while ((m = GTIN_BARE_RE.exec(text))) if (GTIN_LENGTHS.has(m[0].length)) out.add(m[0]);
  return [...out];
}

// "All lots", "no codes", "none", "will be provided by firm": the recall names
// no code, so it is product-level (GTIN red, product name orange).
const ALL_LOTS_RE = /\b(?:all|every)\s+(?:lots?|codes?|dates?|products?|units?|sizes?|batches|lot\s*codes?|best[\s-]*by\s*dates?)\b|\bno\s+(?:lot|code|lot\s*code|lot\s*number)s?\b|\bnot\s+(?:lot\s*)?coded\b|\bno\s+codes?\s+(?:listed|available)\b|^\s*(?:none|n\/a|not applicable)\s*\.?\s*$|\bwill\s+be\s+provided\b/i;

// A lot token split into its letter prefix and its trailing digits.
function splitLot(token) {
  const m = /^([A-Za-z]*)(\d+)$/.exec(String(token || '').trim());
  if (!m) return null;
  return { prefix: m[1], digits: m[2], num: parseInt(m[2], 10) };
}

// "PB24105 through PB24150": both ends share the prefix and digit count,
// the second is larger, and the span is not absurd.
function validRange(from, to) {
  const a = splitLot(from), b = splitLot(to);
  if (!a || !b) return false;
  if (a.prefix.toLowerCase() !== b.prefix.toLowerCase()) return false;
  if (a.digits.length !== b.digits.length) return false;
  if (a.digits.length < 2 || a.digits.length > 12) return false;
  if (!(b.num > a.num)) return false;
  return b.num - a.num <= 100000;
}

const RANGE_RE = /\b([A-Za-z]{0,6}\d{2,12})\s*(?:through|thru|to|-|–|—)\s*([A-Za-z]{0,6}\d{2,12})\b/gi;
const RANGE_SPACED_DASH_RE = /\b([A-Za-z]{0,6}\d{2,12})\s+[-–—]\s+([A-Za-z]{0,6}\d{2,12})\b/g;

function rangesIn(text, dateTexts) {
  const out = [];
  const seen = new Set();
  const consider = (from, to) => {
    if (dateTexts.has(from) || dateTexts.has(to)) return;
    if (!validRange(from, to)) return;
    const key = from + '|' + to;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to });
  };
  let m;
  // Word separators first ("through", "thru", "to"): the dash form only with spaces
  // around it, so hyphenated lot codes ("108-728-420") stay one code.
  const wordRe = /\b([A-Za-z]{0,6}\d{2,12})\s+(?:through|thru|to)\s+([A-Za-z]{0,6}\d{2,12})\b/gi;
  while ((m = wordRe.exec(text))) consider(m[1], m[2]);
  RANGE_SPACED_DASH_RE.lastIndex = 0;
  while ((m = RANGE_SPACED_DASH_RE.exec(text))) consider(m[1], m[2]);
  return out;
}

const LOT_LABEL_RE = /\b(?:lot(?:\s*(?:no|number|numbers|code|codes|#))?s?|batch(?:\s*(?:no|number|code|codes|#))?(?:es)?|codes?)\s*[:#.]?\s*/gi;
const STOP_WORD_RE = /^(best|use|sell|enjoy|exp|expiration|expires|expiry|upc|gtin|ean|dates?|packed|manufacture[d]?|mfg|item|sku|and|or|through|thru|to|the|of|on|in|with|printed|side|label|affected|units|only|all|no|not|bb)$/i;
const LOT_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.\-\/]{2,29}$/;
const BARE_SMALL_RE = /^\d{1,4}$/;
const DATE_PART_RE = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$|^\d{1,2}[\/.-]\d{4}$|^\d{4}-\d{1,2}-\d{1,2}$/;

function cleanToken(t) {
  return String(t || '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

// `labeled`: the token follows "Lot", "Batch" or "Code", so a short bare
// number ("lot: 6156") is a lot; unlabeled bare numbers of four digits or
// fewer are years and counts.
function isLotToken(t, gtins, dateTexts, labeled) {
  if (!LOT_TOKEN_RE.test(t)) return false;
  if (!/\d/.test(t)) return false;
  if (BARE_SMALL_RE.test(t) && !(labeled && t.length >= 3)) return false;
  if (DATE_PART_RE.test(t)) return false;
  // A date-looking token is not a lot, unless it follows "Lot" and carries
  // letters ("Lot: AUG172026" is a date-coded lot).
  if (dateTexts.has(t) && !(labeled && /[A-Za-z]/.test(t))) return false;
  if (gtins.includes(t.replace(/\D/g, '')) && /^\d[\d\s-]*$/.test(t)) return false;
  if (STOP_WORD_RE.test(t)) return false;
  return true;
}

function lotsIn(text, gtins, dateTexts) {
  const labeled = [];
  const rest = [];
  let m;
  LOT_LABEL_RE.lastIndex = 0;
  while ((m = LOT_LABEL_RE.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    for (const raw of after.split(/[,;&\s]+/)) {
      const t = cleanToken(raw);
      if (!t) continue;
      if (/^(and|or|through|thru|to)$/i.test(t)) continue;   // "lot 26187 and 2576", "PB24105 through PB24150"
      if (STOP_WORD_RE.test(t) || /^(best|use|sell|exp|upc|gtin|dates?|packed|mfg)/i.test(t)) break;
      if (isLotToken(t, gtins, dateTexts, true)) labeled.push(t);
      else if (!/^[A-Za-z]+$/.test(t)) break;   // a plain word keeps going ("Lot codes listed below"), anything else ends the list
    }
  }
  for (const raw of text.split(/[,;&\s]+/)) {
    const t = cleanToken(raw);
    if (t && isLotToken(t, gtins, dateTexts, false)) rest.push(t);
  }
  const out = [];
  const seen = new Set();
  for (const t of [...labeled, ...rest]) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_LOTS) break;
  }
  return out;
}

function parseRecallCodes(input) {
  const src = input || {};
  const codeText = [src.code_info, src.more_code_info].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const productText = String(src.product_description || src.product_name || '').replace(/\s+/g, ' ').trim();
  const all_lots = ALL_LOTS_RE.test(codeText);
  const gtins = [...new Set([...gtinsIn(codeText), ...gtinsIn(productText)])];
  const dates = dateTokens(codeText);
  const dateTexts = new Set(dates.map((d) => d.text));
  const { from: best_by_from, to: best_by_to } = bestByWindow(codeText);
  const lot_ranges = rangesIn(codeText, dateTexts);
  const lots = lotsIn(codeText, gtins, dateTexts);
  return { lots, lot_ranges, gtins, best_by_from, best_by_to, all_lots, parser_version: PARSER_VERSION };
}

// A whole lot code inside a printed range: same prefix (case-insensitive),
// same digit count, number between the ends.
function lotInRange(token, range) {
  if (!range || !range.from || !range.to) return false;
  const a = splitLot(range.from), b = splitLot(range.to), t = splitLot(token);
  if (!a || !b || !t) return false;
  if (t.prefix.toLowerCase() !== a.prefix.toLowerCase()) return false;
  if (t.digits.length !== a.digits.length) return false;
  return t.num >= a.num && t.num <= b.num;
}

// A code inside the range anywhere in a raw capture ("(10)PB24120(17)271231").
// Returns the matched code or null.
function findRangeHit(rawText, range) {
  if (!rawText || !range || !range.from || !range.to) return null;
  const a = splitLot(range.from), b = splitLot(range.to);
  if (!a || !b || a.digits.length !== b.digits.length) return null;
  const prefix = a.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9])${prefix}(\\d{${a.digits.length}})(?!\\d)`, 'gi');
  let m;
  while ((m = re.exec(String(rawText)))) {
    const n = parseInt(m[1], 10);
    if (n >= a.num && n <= b.num) return m[0];
  }
  return null;
}

module.exports = { PARSER_VERSION, parseRecallCodes, parseDateToken, lotInRange, findRangeHit, splitLot, validRange };
