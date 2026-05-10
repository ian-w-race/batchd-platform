// netlify/functions/ocr.js
// Batch'd AI OCR proxy — calls Anthropic API directly via fetch (no SDK dependency)
// Tasks: identify_product | read_barcode | localise_lot | extract_codes | extract_raw_cluster
//
// Speed strategy:
//   - localise_lot        -> haiku (fast localisation pass — only used for stored crops)
//   - extract_codes       -> sonnet (lot code reading needs visual reasoning)
//   - extract_raw_cluster -> sonnet (verbatim inkjet character cluster — accuracy drives recall substring matching)
//   - identify_product    -> haiku (fast; staff can correct; lot code is what matters)
//   - read_barcode        -> haiku

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

async function callAnthropic(model, maxTokens, prompt, imageB64, temperature) {
  // 25-second timeout — Netlify background functions allow 26s; leave 1s buffer.
  // temperature defaults to undefined (lets the API pick its own default ~1.0).
  // For verbatim OCR tasks pass temperature: 0 so the model returns what it sees
  // rather than completing toward a plausible-looking date/lot string.
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('Anthropic API error ' + resp.status + ': ' + err);
  }
  return resp.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { task, image, extra = {} } = JSON.parse(event.body);

    if (!task || !image) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task and image required' }) };
    }

    let model, prompt, maxTokens;

    switch (task) {

      case 'identify_product': {
        // Haiku for speed (~200ms vs ~1000ms for Sonnet).
        // Staff review and correct the name if needed — the lot code matters more for traceability.
        model = MODEL_HAIKU;
        maxTokens = 80;
        prompt = [
          'Read the exact product name from this food packaging label. Include brand, product name, and variant — distinguish carefully between similar types: Helmelk/Mellommelk/Lettmelk/Skummet, Lett/Original/Økologisk/Extra, fat percentages, and weight/size.',
          'Return ONLY: "Brand ProductName Size" (e.g. "Gilde Bacon 150g"). If unreadable: "Unknown Product". No explanations.',
        ].join('\n');
        break;
      }

      case 'read_barcode': {
        model = MODEL_HAIKU;
        maxTokens = 200;
        prompt = 'Read all barcodes visible in this image. Return ONLY a JSON array of strings, e.g. ["1234567890123"]. No markdown. If no barcode is readable, return [].';
        break;
      }

      case 'localise_lot': {
        model = MODEL_HAIKU;
        maxTokens = 150;
        const isUS = extra.isUSRegion;
        prompt = isUS
          ? 'Locate the Traceability Lot Code (TLC) region on this US food packaging. Look for: LOT, L#, BATCH, PACK DATE, MFG DATE, GS1 AI(10).\nReturn ONLY valid JSON: {"found": true, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}\ny_start/y_end are fractions of image height. No markdown.'
          : 'Locate the lot/batch number (partinummer) region on this Norwegian/EU food packaging. Look for: L, Parti, LOT, or inkjet codes near the expiry date.\nReturn ONLY valid JSON: {"found": true, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}\ny_start/y_end are fractions of image height. No markdown.';
        break;
      }

      case 'extract_codes': {
        // Always use Sonnet for main extraction — lot code ID needs proper visual reasoning.
        // Haiku is fast but misses ambiguous codes on Norwegian/EU packaging.
        // Sonnet with a short prompt is faster AND more accurate than Haiku with a long one.
        const useHaiku = extra.useHaiku === true; // only use haiku if explicitly requested
        model = useHaiku ? MODEL_HAIKU : MODEL_SONNET;
        maxTokens = useHaiku ? 300 : 400;
        prompt = extra.prompt || 'Extract lot codes from this food packaging. Return JSON with lot, expiry, lot_confidence fields.';
        break;
      }

      case 'extract_raw_cluster': {
        // Capture-everything-match-later flow: read the printed traceability
        // information verbatim, no parsing. Substring matching at recall time
        // depends on character-level fidelity, so use Sonnet (not Haiku) and
        // pin temperature to 0 so the model returns what it sees instead of
        // completing toward a "plausible" date/lot string.
        //
        // The prompt covers two distinct packaging styles seen in real
        // retail (revised 2026-05 after pilot testing surfaced multi-field
        // sticker labels):
        //   A) Inkjet-on-bare-packaging — short cluster (date + maybe time
        //      and/or lot suffix), printed directly on the carton/can/bag.
        //   B) Printed sticker labels (common on Norwegian retail meat,
        //      fish, dairy) — multiple separately labeled fields like
        //      "Siste forbruksdag 09.05.26" and "Batch: 1324820 19:39"
        //      printed on a paper sticker. The PRE-2026-05 prompt told the
        //      model to "return only the lot/date cluster (usually the
        //      longest sequence printed near the expiry date)" which caused
        //      it to drop the batch field and break recall matching for
        //      this packaging style.
        // The new prompt instructs ALL distinct traceability fields to be
        // captured, separated by ' · ' (space, middle-dot, space), so the
        // substring matcher can hit ANY of them.
        //
        // Failure modes explicitly addressed:
        //   1) Dropping an asterisk-prefixed segment (e.g. "*1599")
        //   2) Reading only the top line of a stacked cluster
        //   3) Concatenating stacked lines with no space separator
        //   4) Substituting visually similar characters (T↔7, 0↔O, etc.)
        //   5) (NEW) Dropping a separately labeled batch/lot row when a
        //      best-by row is also visible on the same printed sticker
        //   6) (NEW) Over-capturing non-traceability text (supplier name,
        //      country of origin, plant approval numbers, weight, etc.)
        // Each failure mode gets a worked example with right vs wrong
        // output. Negative examples ("WRONG") anchor the model's behaviour
        // better than positive descriptions alone.
        model = MODEL_SONNET;
        maxTokens = 240;
        // temperature 0 — assigned below in the api call so we can use it
        // for THIS task without changing other tasks' behaviour.
        prompt = [
          'You are transcribing traceability information from a photo of food packaging. The output is substring-matched against recall records, so character-level fidelity is the entire job. Do NOT interpret, normalize, abbreviate, or "fix" what you see.',
          '',
          'TASK',
          'Return a single raw string containing the EXACT printed traceability characters visible in the image. If multiple distinct traceability fields are present, capture ALL of them in reading order (top to bottom, left to right), separated by \' · \' (space, middle-dot, space).',
          '',
          'WHAT COUNTS AS A TRACEABILITY FIELD',
          '- Lot codes / batch numbers (often labeled "Lot:", "Batch:", "Parti:", "Charge:", "L:", "B:", or unlabeled inkjet near the expiry date)',
          '- Best-by / use-by dates (often labeled "Best før:", "Siste forbruksdag:", "Best by:", "Use by:", "EXP:", or unlabeled inkjet)',
          '- Production / packaging dates (often labeled "Produksjonsdato:", "Pakkedato:", "MFG:", "Packed on:")',
          '- Time stamps printed alongside dates or batch numbers',
          '- Standalone alphanumeric sequences printed in the inkjet/laser-etched area near other traceability info',
          '',
          'When a printed sticker shows multiple labeled fields (e.g. "Siste forbruksdag 09.05.26" on one line and "Batch: 1324820 19:39" on another), capture ALL of them, separated by \' · \'. Keep the printed field labels — they help the substring matcher.',
          '',
          'CHARACTER FIDELITY — the most common failure is substituting a character that looks similar in dot-matrix inkjet print:',
          '- T vs 7 — the T crossbar can look like the top of a 7. Return what is actually printed.',
          '- 0 vs O — return what you actually see, do not guess based on context.',
          '- 1 vs I vs L — return what you actually see.',
          '- 8 vs B, 5 vs S, 2 vs Z — return what you actually see.',
          '- Do NOT substitute a character because the substitution "looks more like a date" or "looks more like a time".',
          '- If a character is faint or uncertain: include your best guess. Do not skip it.',
          '',
          'LINE HANDLING — clusters often span multiple lines:',
          '- Single-line cluster: read left-to-right.',
          '- Stacked lines WITHIN ONE field (e.g. inkjet date on top, time on bottom): read TOP line first, ADD A SINGLE SPACE, then the next line. EVERY line must appear. The space separator is REQUIRED.',
          '- DISTINCT fields (e.g. a date row and a separately labeled batch row on a printed sticker): separate with \' · \', NOT a space.',
          '',
          'INCLUDE EVERYTHING WITHIN A FIELD',
          '- All separator characters: dots, slashes, asterisks, colons, dashes, spaces — keep them as printed.',
          '- All segments. Do NOT assume an asterisk-prefixed or trailing portion is metadata to skip. Asterisk segments are part of the lot cluster (e.g. "06.06.26*1599 10:48-7" is a single complete cluster).',
          '- Field labels themselves ("Batch:", "Lot:", "Best før:", "Siste forbruksdag:", etc.) — keep them as printed.',
          '',
          'WHAT NOT TO INCLUDE',
          '- Country of origin, supplier name, address, phone number, weight, temperature info, plant approval numbers (e.g. "NO XXXX EF") — these are not traceability fields.',
          '- Marketing copy, ingredient lists, allergen warnings, recipes, nutrition facts.',
          '- Barcode digits — those come from a separate scan path.',
          '',
          'CONCRETE EXAMPLES',
          '',
          '1) Inkjet on bare packaging, two-line cluster:',
          '   Image shows two stacked inkjet lines:',
          '     17.06.26 T707',
          '     12:25',
          '   CORRECT output:  17.06.26 T707 12:25',
          '   WRONG: 17.06.26T70712:25  (concatenated, no space)',
          '   WRONG: 17.06.26 12:25  (dropped the middle token)',
          '   WRONG: 17.06.26 TUT 12:25  (substituted T707 → TUT)',
          '',
          '2) Inkjet with asterisk segment:',
          '   Image shows: 06.06.26*1599 10:48-7',
          '   CORRECT output: 06.06.26*1599 10:48-7',
          '',
          '3) Printed sticker label with multiple labeled fields:',
          '   Image shows two separately labeled rows:',
          '     Siste forbruksdag 09.05.26',
          '     Batch: 1324820 19:39',
          '   CORRECT output: Siste forbruksdag 09.05.26 · Batch: 1324820 19:39',
          '   WRONG: Siste forbruksdag 09.05.26  (dropped the batch field — this is the failure we are fixing)',
          '   WRONG: 09.05.26 1324820  (stripped the field labels)',
          '',
          '4) Date only, no batch label visible:',
          '   Image shows: Best før: 14/08/2026',
          '   CORRECT output: Best før: 14/08/2026',
          '',
          'OUTPUT',
          'Return ONE raw string. No JSON, no labels other than what is printed in the image, no quotes, no commentary, no explanation. If you cannot read any traceability characters at all, return an empty string.',
        ].join('\n');
        break;
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown task: ' + task }) };
    }

    // Pin temperature to 0 for verbatim OCR (extract_raw_cluster). All other
    // tasks keep the API default — they involve some interpretation
    // (product naming, lot field structuring) where deterministic behaviour
    // is less critical and creativity occasionally helps.
    const temperature = task === 'extract_raw_cluster' ? 0 : undefined;
    const response = await callAnthropic(model, maxTokens, prompt, image, temperature);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };

  } catch (err) {
    console.error('OCR function error:', err);
    // Don't expose internal error details (may contain API key validation info)
    const safeMsg = err.message?.startsWith('Anthropic API error') ? 'OCR service unavailable' : (err.message || 'Internal error');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: safeMsg }),
    };
  }
};
