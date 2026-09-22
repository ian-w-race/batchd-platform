// netlify/functions/trace.js
// Retired 2026-09-20 with the manufacturer side of the platform. Nothing in the
// retailer-only platform writes product_lots or shipments, so this lookup could
// only ever show legacy rows. Kept as a stub so old QR codes get a clear answer.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
exports.handler = async () => ({
  statusCode: 410,
  headers: CORS,
  body: JSON.stringify({ error: 'retired', message: 'Product traceability lookup has been retired.' }),
});
