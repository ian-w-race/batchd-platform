// src/shared/gs1.js
// GS1 label parsing (improvement plan A2 part 3, 2026-11-01), moved verbatim
// from index.html so the dashboard's imports and the tests can use the same
// parser the scanner uses. Exposed as window.Batchd.gs1.
//   parseGS1            GS1-128 / DataBar / Digital Link: AIs to lot, GTIN, dates, weights
//   parseGS1DigitalLink GS1 Digital Link URLs (QR / DataMatrix)
//   gs1ParseDate        6-digit GS1 date (YYMMDD) to YYYY-MM-DD
//   extractBestBefore   best-effort ISO date from a typed or read lot cluster
// Display formatting by region (formatGS1Expiry) stays in the scanner.

// ── GS1 DIGITAL LINK PARSER ───────────────────────────────────
// Parses GS1 Digital Link URLs encoded in QR / DataMatrix codes.
// Format: https://[domain]/[path]/01/{gtin}/10/{lot}/17/{expiry}
// Brands may host on their own domain; the match is by path structure only.
export function parseGS1DigitalLink(raw) {
  const result = { gtin: null, lot: null, expiry: null, serial: null, all: {}, isDigitalLink: false };
  if (!raw) return result;

  let url;
  try { url = new URL(raw); } catch(e) { return result; }

  // Walk path segments looking for AI code / value pairs
  // e.g. /somebase/01/09506000134352/10/ABC123/17/260101
  const parts = url.pathname.split('/').filter(Boolean);
  const AI_KEYS = { '00':'sscc','01':'gtin','02':'content','10':'lot','17':'expiry','21':'serial','22':'cpv' };

  for (let i = 0; i < parts.length - 1; i++) {
    const ai = parts[i];
    if (AI_KEYS[ai]) {
      const val = decodeURIComponent(parts[i + 1]);
      result.all[ai] = val;
      if (ai === '01') result.gtin = val.replace(/^0+(?=\d{13}$)/, ''); // normalise to 13-digit EAN if possible
      if (ai === '10') result.lot = val;
      if (ai === '17') result.expiry = val; // YYMMDD
      if (ai === '21') result.serial = val;
      result.isDigitalLink = true;
      i++; // consume the value segment
    }
  }

  // Also check query string for compressed/redirected forms: ?lot=X&exp=Y
  const p = url.searchParams;
  if (p.get('10') && !result.lot)     { result.lot = p.get('10');    result.all['10'] = result.lot;    result.isDigitalLink = true; }
  if (p.get('17') && !result.expiry)  { result.expiry = p.get('17'); result.all['17'] = result.expiry; result.isDigitalLink = true; }
  if (p.get('01') && !result.gtin)    { result.gtin = p.get('01');   result.all['01'] = result.gtin;   result.isDigitalLink = true; }

  return result;
}

/** Parse a 6-digit GS1 date (YYMMDD) into ISO YYYY-MM-DD string */
export function gs1ParseDate(yymmdd) {
  if (!yymmdd || yymmdd.length < 6) return null;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (mm === '00' || dd === '00') return null; // GS1 spec: 00 = last day of month
  const year = parseInt(yy) >= 50 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
}

/** Derives semantic helper fields from the raw AI map after parsing */
function _deriveGS1SemanticFields(gs1) {
  const a = gs1.all;
  // Dates: production AI(11/13), best-before AI(15), expiry AI(17)
  gs1.productionDate = gs1ParseDate(a['11'] || a['13']) || null;
  gs1.bestBefore     = gs1ParseDate(a['15']) || null;
  gs1.expiry         = gs1ParseDate(a['17']) || null;
  // The most relevant date for the expiry field (expiry > best-before > production)
  gs1.bestDate       = gs1.expiry || gs1.bestBefore || null;
  // Other useful AIs
  gs1.serial         = a['21'] || null;
  gs1.quantity       = a['37'] ? parseInt(a['37'], 10) : null;
  gs1.gtin           = a['01'] || a['02'] || null;
  gs1.packDate       = gs1ParseDate(a['13']) || null;
  // Net weight from AI 310n (kg) or 320n (lb); n is the implied decimal count.
  const _w = (prefix) => {
    for (let n = 0; n <= 6; n++) {
      const v = a[prefix + n];
      if (v && /^\d{6}$/.test(v)) return parseInt(v, 10) / Math.pow(10, n);
    }
    return null;
  };
  gs1.netWeightKg = _w('310');
  gs1.netWeightLb = _w('320');
}
export function parseGS1(raw) {
  const result = { lot: null, batch: null, all: {} };
  if (!raw) return result;

  // ── GS1 Digital Link URL — check first ────────────────────
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const dl = parseGS1DigitalLink(raw);
    if (dl.isDigitalLink) {
      result.lot   = dl.lot;
      result.batch = dl.lot;
      result.all   = dl.all;
      result._digitalLink = dl;
      _deriveGS1SemanticFields(result);
      return result;
    }
  }

  // ── Plain GTIN guard ──────────────────────────────────────
  // EAN-8 / UPC-A / EAN-13 / GTIN-14 are pure product identifiers with NO
  // embedded Application Identifiers. The AI parser below would otherwise
  // mis-read coincidental digit substrings (e.g. "10" in the middle of a
  // 13-digit EAN) as a lot code AI and invent a false TLC. A real GS1-128
  // payload either uses human-readable parens — "(10)ABC123" — or a raw
  // FNC1 sentinel (\x1D / ]C1 / ]d2 / ]e0). If neither is present and the
  // value is just 8/12/13/14 digits, treat it as a plain GTIN.
  const _FNC1 = String.fromCharCode(29);
  const _stripped = String(raw).replace(/^\]C1|^\]d2|^\]e0/i, '');
  const _hasParens = /\(\d{2,4}\)/.test(raw);
  const _hasFNC1   = raw.indexOf(_FNC1) !== -1;
  if (!_hasParens && !_hasFNC1 && /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(_stripped)) {
    result.gtin = _stripped;
    return result;
  }

  const AI_LENGTHS = {
    '00': 18, '01': 14, '02': 14,
    '10': null, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6,
    '20': 2, '21': null, '22': null, '30': null, '37': null,
    '240': null, '241': null, '242': null, '243': null,
    '250': null, '251': null, '253': null, '254': null, '255': null,
    '310': 6, '311': 6, '312': 6, '313': 6, '314': 6, '315': 6, '316': 6,
    // Net weight AIs are four digits: 310n (kg) and 320n (lb), n = implied
    // decimals, then a six-digit value. Listed as 4-char keys so the raw
    // parser (which tries 4, 3, 2) reads them correctly. Added 2026-10-03
    // for case labels; 320n is the US form.
    '3100': 6, '3101': 6, '3102': 6, '3103': 6, '3104': 6, '3105': 6, '3106': 6,
    '3200': 6, '3201': 6, '3202': 6, '3203': 6, '3204': 6, '3205': 6, '3206': 6,
    '400': null, '401': null, '402': null, '403': null,
    '410': 13, '411': 13, '412': 13, '413': 13, '414': 13, '415': 13, '416': 13, '417': 13,
    '420': null, '421': null, '422': null,
    '710': null, '711': null, '712': null, '713': null, '714': null,
    '7003': null, '7004': null,
    '8001': 14, '8002': null, '8003': null, '8004': null, '8005': 6,
    '8006': 18, '8007': null, '8008': null, '8010': null, '8011': null,
    '8012': null, '8013': null, '8017': 18, '8018': 18, '8019': null,
    '8020': null, '8026': 18,
    '90': null,
    '91': null, '92': null, '93': null, '94': null, '95': null,
    '96': null, '97': null, '98': null, '99': null,
  };

  const FNC1 = String.fromCharCode(29);

  // Human-readable format: (10)LOT123(17)260101
  const humanRe = /\((\d{2,4})\)([^(]*)/g;
  let humanMatch;
  let foundHuman = false;
  while ((humanMatch = humanRe.exec(raw)) !== null) {
    foundHuman = true;
    const ai = humanMatch[1];
    const val = humanMatch[2].trim();
    result.all[ai] = val;
    if (ai === '10') { result.lot = val; result.batch = val; }
  }
  if (foundHuman) { _deriveGS1SemanticFields(result); return result; }

  // Raw concatenated format
  let s = raw.replace(/^\]C1|^\]d2|^\]e0/i, '');
  let i = 0, safetyLimit = 0;
  while (i < s.length && safetyLimit++ < 30) {
    if (s[i] === FNC1) { i++; continue; }
    let ai = null, aiLen = 0;
    for (const len of [4, 3, 2]) {
      const candidate = s.substr(i, len);
      if (Object.prototype.hasOwnProperty.call(AI_LENGTHS, candidate)) {
        ai = candidate; aiLen = len; break;
      }
    }
    if (!ai) { i++; continue; }
    i += aiLen;
    const fixedLen = AI_LENGTHS[ai];
    let val = '';
    if (fixedLen !== null) {
      val = s.substr(i, fixedLen); i += fixedLen;
    } else {
      // Variable-length value. GS1 terminates these with FNC1 (\x1D). When the
      // scanner preserved any FNC1 in this string, trust it: read to the next
      // FNC1 or the end. Only when the whole string has no FNC1 at all fall
      // back to guessing a boundary, and then only on the AIs that follow a
      // lot on food case labels. The old guess used the full AI table, so a
      // lot like RM240928 stopped at "RM" because "240" is an AI prefix
      // (2026-10-03, Phase 2).
      const _BOUNDARY_AIS = ['00','01','02','10','11','13','15','17','21','37',
        '3100','3101','3102','3103','3104','3105','3106','3200','3201','3202','3203','3204','3205','3206'];
      let end = i;
      while (end < s.length && s[end] !== FNC1) {
        if (!_hasFNC1 && end > i) {
          let foundAI = false;
          for (const len of [4, 2]) {
            if (_BOUNDARY_AIS.includes(s.substr(end, len))) { foundAI = true; break; }
          }
          if (foundAI) break;
        }
        end++;
      }
      val = s.substring(i, end); i = end;
      if (s[i] === FNC1) i++;
    }
    if (val) {
      result.all[ai] = val;
      if (ai === '10') { result.lot = val; result.batch = val; }
    }
  }

  _deriveGS1SemanticFields(result);
  return result;
}

// extractBestBefore: pure, no API. Best-effort ISO date pulled from the raw
// character cluster. Tries DD.MM.YY, DD.MM.YYYY, MM/DD/YY, MM/DD/YYYY,
// YYYY-MM-DD. Returns null if no date pattern matches. Stored in the
// expiry_date column for review-screen display only, never used for recall
// matching, which runs on raw_capture verbatim.
export function extractBestBefore(rawString) {
  if (!rawString) return null;
  const ddmmyy = rawString.match(/\b(\d{2})\.(\d{2})\.(\d{2})\b/);
  if (ddmmyy) {
    const year = parseInt(ddmmyy[3], 10) + 2000;
    return `${year}-${ddmmyy[2]}-${ddmmyy[1]}`;
  }
  const ddmmyyyy = rawString.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }
  const mmddyy = rawString.match(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/);
  if (mmddyy) {
    const year = mmddyy[3].length === 2 ? parseInt(mmddyy[3], 10) + 2000 : parseInt(mmddyy[3], 10);
    return `${year}-${mmddyy[1]}-${mmddyy[2]}`;
  }
  const iso = rawString.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
