// netlify/functions/ocr.js
// Batch'd AI OCR proxy — Anthropic vision API, server-side key
// Tasks: identify_product | read_barcode | localise_lot | extract_codes
//
// Speed strategy:
//   - localise_lot  → haiku (fast localisation pass)
//   - extract_codes → haiku by default (useHaiku: true from client)
//                  → sonnet only for escalation (useHaiku: false, adversarial pass)
//   - identify_product → haiku (product name from label photo)
//   - read_barcode     → haiku (barcode AI read)

const Anthropic = require('@anthropic-ai/sdk');

const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MAX_TOKENS   = 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { task, image, extra = {} } = JSON.parse(event.body);
    if (!task || !image) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task and image required' }) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let model, prompt, maxTokens;

    switch (task) {

      // ── PRODUCT IDENTIFICATION ──────────────────────────────
      case 'identify_product': {
        model = MODEL_HAIKU;
        maxTokens = 80;
        prompt = `You are identifying a food product from a photo of its packaging.
Return ONLY the product name (brand + product, e.g. "TINE Helmelk 1.5L" or "Gilde Kjøttdeig 400g").
No explanations. No punctuation. Just the product name.
If you cannot identify it, return "Unknown Product".`;
        break;
      }

      // ── BARCODE AI READ ─────────────────────────────────────
      case 'read_barcode': {
        model = MODEL_HAIKU;
        maxTokens = 200;
        prompt = `Read all barcodes visible in this image. Return ONLY a JSON array of strings, e.g. ["1234567890123"]. No markdown. If no barcode is readable, return [].`;
        break;
      }

      // ── LOT CODE LOCALISATION ───────────────────────────────
      // Fast pass to find WHERE on the image the lot code is.
      // Returns crop region (y_start, y_end as 0-1 fractions).
      case 'localise_lot': {
        model = MODEL_HAIKU;
        maxTokens = 150;
        const isUS = extra.isUSRegion;
        prompt = isUS
          ? `Locate the Traceability Lot Code (TLC) region on this US food packaging. Look for labels: LOT, L#, BATCH, PACK DATE, MFG DATE, or GS1 AI(10).
Return ONLY valid JSON: {"found": true/false, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}
y_start and y_end are fractions of image height (0=top, 1=bottom). No markdown.`
          : `Locate the lot/batch number (partinummer) region on this Norwegian/EU food packaging. Look for: L, Parti, LOT, Best før/Holdbar til area, or inkjet codes near the expiry date.
Return ONLY valid JSON: {"found": true/false, "y_start": 0.0, "y_end": 1.0, "description": "brief note"}
y_start and y_end are fractions of image height (0=top, 1=bottom). No markdown.`;
        break;
      }

      // ── LOT CODE EXTRACTION ─────────────────────────────────
      // Primary extraction pass.
      // useHaiku (default): fast haiku pass — covers 90%+ of cases
      // !useHaiku: sonnet escalation — for hard cases where haiku returned null
      case 'extract_codes': {
        const useHaiku = extra.useHaiku !== false; // default true
        model = useHaiku ? MODEL_HAIKU : MODEL_SONNET;
        maxTokens = useHaiku ? 300 : 500;
        // Prompt comes entirely from client — it's already built with full instructions
        prompt = extra.prompt || 'Extract lot codes from this food packaging. Return JSON with lot, batch, expiry, lot_confidence fields.';
        break;
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown task: ${task}` }) };
    }

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: image,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };

  } catch (err) {
    console.error('OCR function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
