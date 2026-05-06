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
        // Capture-everything-match-later flow: read the inkjet date/lot cluster
        // verbatim, no parsing. Substring matching at recall time depends on
        // character-level fidelity, so use Sonnet (not Haiku) and pin
        // temperature to 0 so the model returns what it sees instead of
        // completing toward a "plausible" date/lot string.
        //
        // Prompt is structured around the actual failure modes seen in pilot
        // testing:
        //   1) Dropping an asterisk-prefixed segment (e.g. "*1599") that the
        //      model thought was trailing metadata
        //   2) Reading only the top line of a 2-line stacked cluster
        //      ("06.06.26*1599" on top, "10:48-7" below — the second line
        //      gets dropped)
        //   3) Concatenating stacked lines with no space separator (e.g.
        //      "17.06.26 T707" + "12:25" returned as "17.06.26T70712:25" or
        //      "17.06.26 T70712:25")
        //   4) Substituting characters that look similar in inkjet print —
        //      "T707" returned as "TUT" or "1YY", "12:25" returned as
        //      "10:25". This is the model "interpreting" instead of reading.
        // The prompt names each failure mode explicitly with a worked
        // example of right vs wrong output. Negative examples ("WRONG")
        // anchor the model's behaviour better than positive descriptions.
        model = MODEL_SONNET;
        maxTokens = 200;
        // temperature 0 — assigned below in the api call so we can use it
        // for THIS task without changing other tasks' behaviour.
        prompt = [
          'You are transcribing an inkjet-printed lot/date cluster from food packaging. The output is substring-matched against recall records, so character-level fidelity is the entire job. Do NOT interpret, normalize, abbreviate, or "fix" what you see.',
          '',
          'TASK',
          'Return the exact characters from the inkjet print, in reading order, as a single raw string.',
          '',
          'CHARACTER FIDELITY — the most common failure is substituting a character that looks similar in dot-matrix inkjet print:',
          '- T vs 7 — the T crossbar can look like the top of a 7. Return what is actually printed.',
          '- 0 vs O — return what you actually see, do not guess based on context.',
          '- 1 vs I vs L — return what you actually see.',
          '- 8 vs B, 5 vs S, 2 vs Z — return what you actually see.',
          '- Do NOT substitute a character because the substitution "looks more like a date" or "looks more like a time".',
          '- If a character is faint or uncertain: include your best guess. Do not skip it.',
          '',
          'LINE HANDLING — many lot/date clusters span 2 lines stacked vertically:',
          '- Single-line cluster: read left-to-right.',
          '- 2-line (or more) stacked cluster: read TOP line first, ADD A SINGLE SPACE, then read the next line. EVERY line must appear in the output. The space separator between lines is REQUIRED.',
          '- Concrete example. Suppose the package shows two lines printed in inkjet:',
          '    Line 1: 17.06.26 T707',
          '    Line 2: 12:25',
          '  CORRECT output:  17.06.26 T707 12:25',
          '  WRONG output: 17.06.26T70712:25  (concatenated, no space between lines)',
          '  WRONG output: 17.06.26 12:25  (dropped the middle token)',
          '  WRONG output: 17.06.26 TUT 12:25  (substituted T707 → TUT)',
          '  WRONG output: 17.06.26 1YY 10:25  (substituted T707 → 1YY and 12 → 10)',
          '',
          'INCLUDE EVERYTHING',
          '- All separator characters between tokens: dots, slashes, asterisks, colons, dashes, spaces — keep them as printed.',
          '- All segments. Do NOT assume an asterisk-prefixed or trailing portion is metadata to skip. Asterisk segments are part of the lot cluster (e.g. "06.06.26*1599 10:48-7" is a single complete cluster).',
          '',
          'OUTPUT',
          'Return ONE raw string. No JSON, no labels, no quotes, no commentary, no explanation. If you cannot read any inkjet-printed characters at all, return an empty string.',
          '',
          'If the image contains multiple unrelated inkjet clusters, return only the lot/date cluster (usually the longest sequence printed near the expiry date).',
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
