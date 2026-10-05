/**
 * Price / rating extraction from untrusted search-result text.
 *
 * Jobi never invents prices. A price is only ever reported when a currency
 * marker is explicitly present in the text; a bare number is ignored so that
 * "2 guests" or "3 nights" can never be mistaken for a room rate.
 */

export interface ExtractedPrice {
  amount: number;
  currency: string;
}

/** Plausible hotel-price window; anything outside is treated as noise. */
const MIN_PRICE = 100;
const MAX_PRICE = 10_000_000;

const CURRENCY_PATTERNS: Array<{ currency: string; regex: RegExp }> = [
  { currency: "INR", regex: /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/gi },
  { currency: "USD", regex: /(?:us\$|\$|usd)\s*([\d,]+(?:\.\d+)?)/gi },
  { currency: "EUR", regex: /(?:€|eur)\s*([\d,]+(?:\.\d+)?)/gi },
  { currency: "GBP", regex: /(?:£|gbp)\s*([\d,]+(?:\.\d+)?)/gi },
  { currency: "AED", regex: /(?:aed|د\.إ)\s*([\d,]+(?:\.\d+)?)/gi },
  { currency: "SGD", regex: /(?:s\$|sgd)\s*([\d,]+(?:\.\d+)?)/gi },
];

function parseAmount(raw: string): number | undefined {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  if (value < MIN_PRICE || value > MAX_PRICE) return undefined;
  return Math.round(value);
}

/**
 * Find the first plausible price in `text`. Returns null when no currency
 * marker is present — callers must render `null` prices as "price unavailable".
 */
export function extractPrice(text: string | undefined | null): ExtractedPrice | null {
  if (!text) return null;
  for (const { currency, regex } of CURRENCY_PATTERNS) {
    // Fresh lastIndex per call (the regexes are module-level and `g` flagged).
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (amount !== undefined) return { amount, currency };
  }
  return null;
}

/**
 * Backwards-compatible helper: the numeric price of the first recognised
 * currency amount in `text`, or undefined. New code should prefer
 * `extractPrice` so the currency is preserved.
 */
export function extractObservedPrice(text: string): number | undefined {
  return extractPrice(text)?.amount;
}

/** Extract a rating like "8.4/10" or "4.5 out of 5" if it is clearly present. */
export function extractRating(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const outOf = /([0-9](?:\.\d)?)\s*(?:\/|out of)\s*(5|10)\b/i.exec(text);
  if (outOf) {
    const value = Number.parseFloat(outOf[1]);
    const scale = Number.parseInt(outOf[2], 10);
    if (!Number.isFinite(value) || value <= 0 || value > scale) return undefined;
    return Math.round((value / scale) * 50) / 10;
  }
  const stars = /([1-5](?:\.\d)?)\s*(?:star|stars)\b/i.exec(text);
  if (stars) {
    const value = Number.parseFloat(stars[1]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}
