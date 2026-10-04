import type { ParsedQuery } from "./types";

/**
 * Deterministic trip-query parser.
 *
 * This runs on the client so the user gets an instant "I understood" card, and
 * is also the fallback whenever the AI parser is unavailable. It is deliberately
 * conservative: it never invents dates or budgets, and always returns a shape
 * the review step can render and the user can correct.
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const PREFERENCE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bpool|swimming\b/i, "pool"],
  [/\bbeach\b/i, "near beach"],
  [/\bsea view|ocean view\b/i, "sea view"],
  [/\bbreakfast\b/i, "breakfast included"],
  [/\bwifi|wi-fi\b/i, "wifi"],
  [/\bparking\b/i, "parking"],
  [/\bspa\b/i, "spa"],
  [/\bgym|fitness\b/i, "gym"],
  [/\bpet[s]? friendly\b/i, "pet friendly"],
  [/\bfamily\b/i, "family friendly"],
  [/\bair ?condition|a\/c|\bac\b/i, "air conditioning"],
  [/\brestaurant\b/i, "restaurant"],
  [/\bairport\b/i, "near airport"],
  [/\bhill|hilltop|hill station\b/i, "hill view"],
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Return the next occurrence of a month/day that is not in the past. */
function resolveDate(month: number, day: number, now: Date): Date {
  const candidate = new Date(now.getFullYear(), month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (candidate.getTime() < today.getTime()) {
    return new Date(now.getFullYear() + 1, month, day);
  }
  return candidate;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** "december 12" / "12 december" / "12 dec 2026" */
function findMonthDay(text: string, now: Date): { date: Date; index: number } | null {
  const monthNames = Object.keys(MONTHS).join("|");
  const monthFirst = new RegExp(
    `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?\\b`,
    "i",
  );
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:[,\\s]+(\\d{4}))?\\b`,
    "i",
  );
  const m1 = monthFirst.exec(text);
  if (m1) {
    const month = MONTHS[m1[1].toLowerCase()];
    const day = parseInt(m1[2], 10);
    const year = m1[3] ? parseInt(m1[3], 10) : undefined;
    const date = year !== undefined ? new Date(year, month, day) : resolveDate(month, day, now);
    return { date, index: m1.index };
  }
  const m2 = dayFirst.exec(text);
  if (m2) {
    const month = MONTHS[m2[2].toLowerCase()];
    const day = parseInt(m2[1], 10);
    const year = m2[3] ? parseInt(m2[3], 10) : undefined;
    const date = year !== undefined ? new Date(year, month, day) : resolveDate(month, day, now);
    return { date, index: m2.index };
  }
  return null;
}

/** numeric dates like 12/12 or 12-12-2026 */
function findNumericDate(text: string, now: Date, searched: string): Date | null {
  const re = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    if (searched.includes(m[0])) continue;
    let year: number | undefined;
    if (m[3]) {
      year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
    }
    return year !== undefined ? new Date(year, month, day) : resolveDate(month, day, now);
  }
  return null;
}

function parseBudget(text: string): { budget?: number; budgetType: "total" | "per_night" } {
  const perNight = /\b(per\s*night|a\s*night|nightly|each\s*night|\/\s*night)\b/i.test(text);
  const budgetType: "total" | "per_night" = perNight ? "per_night" : "total";

  const rupee = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i.exec(text);
  if (rupee) {
    let value = parseFloat(rupee[1].replace(/,/g, ""));
    if (rupee[2]) value *= 1000;
    if (!Number.isNaN(value) && value > 0) return { budget: Math.round(value), budgetType };
  }
  const kMatch = /\b(\d{1,3})\s*k\b/i.exec(text);
  if (kMatch) {
    const value = parseInt(kMatch[1], 10) * 1000;
    if (value > 0) return { budget: value, budgetType };
  }
  const under = /\b(?:under|below|less than|within|max|upto|up to)\s*([\d,]+)/i.exec(text);
  if (under) {
    const value = parseInt(under[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(value) && value > 0) return { budget: value, budgetType };
  }
  return { budgetType };
}

function parseGuests(text: string): number {
  const adult = /\b(\d{1,2})\s*(?:adults?|people|persons?|guests?|pax|travel(l)?ers?)\b/i.exec(text);
  if (adult) return Math.max(1, Math.min(20, parseInt(adult[1], 10)));
  const forN = /\bfor\s+(\d{1,2})\b/i.exec(text);
  if (forN) return Math.max(1, Math.min(20, parseInt(forN[1], 10)));
  return 2;
}

function parseRooms(text: string): number {
  const m = /\b(\d{1,2})\s*(?:rooms?|bedrooms?)\b/i.exec(text);
  if (m) return Math.max(1, Math.min(10, parseInt(m[1], 10)));
  return 1;
}

function parseNights(text: string): number | undefined {
  const m = /\b(\d{1,2})\s*(?:nights?|nites?)\b/i.exec(text);
  if (m) return Math.max(1, Math.min(30, parseInt(m[1], 10)));
  return undefined;
}

const DESTINATION_STOPWORDS = new Set([
  "i",
  "find",
  "need",
  "looking",
  "want",
  "search",
  "book",
  "hotel",
  "hotels",
  "stay",
  "a",
  "an",
  "the",
]);

function parseDestination(text: string): string {
  // "hotel in Goa" / "stay at Jaipur"
  const inMatch = /\b(?:in|at|around)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/.exec(text);
  if (inMatch) return inMatch[1].trim();

  // "Goa for 3 nights…" — a bare leading destination
  const leading = /^\s*([A-Za-z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/.exec(text);
  if (leading) {
    const candidate = leading[1].trim();
    if (!DESTINATION_STOPWORDS.has(candidate.split(" ")[0].toLowerCase())) return candidate;
  }

  const lower = /\b(?:in|at|around)\s+([a-z][a-zA-Z]+)\b/.exec(text);
  if (lower) return lower[1].charAt(0).toUpperCase() + lower[1].slice(1);
  return "";
}

function parseLocality(text: string, destination: string): string | undefined {
  const patterns = [
    /\b(?:near|close to|walking distance (?:to|from)|next to|beside)\s+([A-Z][\w']*(?:\s+[A-Z][\w']*){0,2})/,
    /\b(?:near|close to)\s+([a-z][\w']*(?:\s+[a-z][\w']*){0,2})/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const candidate = m[1].trim().replace(/[.,]$/, "");
      if (candidate && candidate.toLowerCase() !== destination.toLowerCase()) return candidate;
    }
  }
  return undefined;
}

function parseProximity(text: string): number | undefined {
  const m = /\b(?:within|under|inside|less than)\s*(\d{1,2}(?:\.\d)?)\s*(?:km|kilometers?|kms)\b/i.exec(text);
  if (m) return parseFloat(m[1]);
  const m2 = /\b(\d{1,2})\s*(?:km|kilometers?|kms)\b/i.exec(text);
  if (m2) return parseFloat(m2[1]);
  const mins = /\b(?:within|under)\s*(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(text);
  if (mins) return Math.round((parseInt(mins[1], 10) / 12) * 10) / 10; // ~12 min/km
  return undefined;
}

function parsePreferences(text: string): string[] {
  const out: string[] = [];
  for (const [re, label] of PREFERENCE_KEYWORDS) {
    if (re.test(text) && !out.includes(label)) out.push(label);
  }
  return out;
}

export interface ParseOptions {
  /** Injectable "now" for deterministic tests. */
  now?: Date;
}

/** Parse a free-text trip request into a structured query. Never throws. */
export function parseTripQuery(raw: string, options: ParseOptions = {}): ParsedQuery {
  const text = (raw ?? "").trim();
  const now = options.now ?? new Date();

  const destination = parseDestination(text);
  const locality = parseLocality(text, destination);

  const searched: string[] = [];
  const first = findMonthDay(text, now);
  let checkIn = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  let second: { date: Date; index: number } | null = null;

  if (first) {
    checkIn = first.date;
    searched.push(text.slice(first.index, first.index + 30));
    const afterFirst = text.slice(first.index + 6);
    second = findMonthDay(afterFirst, now);
    if (!second) {
      const numeric = findNumericDate(afterFirst, now, "");
      if (numeric) second = { date: numeric, index: 0 };
      else {
        const before = text.slice(0, first.index);
        second = findMonthDay(before, now);
      }
    }
    if (second && second.date.getTime() <= checkIn.getTime()) {
      second = { date: addDays(checkIn, 1), index: 0 };
    }
  } else {
    const numeric = findNumericDate(text, now, "");
    if (numeric) {
      checkIn = numeric;
      const after = text.replace(numeric.toString(), "");
      const numeric2 = findNumericDate(after, now, numeric.toDateString());
      if (numeric2) second = { date: numeric2, index: 0 };
    }
  }

  const nights = parseNights(text);
  let checkOut: Date;
  if (second) {
    checkOut = second.date;
  } else if (nights) {
    checkOut = addDays(checkIn, nights);
  } else {
    checkOut = addDays(checkIn, 2);
  }

  const { budget, budgetType } = parseBudget(text);
  const guests = parseGuests(text);
  const rooms = parseRooms(text);
  const proximityKm = parseProximity(text);
  const preferences = parsePreferences(text);
  if (locality) preferences.unshift(`near ${locality}`);
  if (nights) preferences.push(`${nights} nights`);

  return {
    destination,
    locality,
    proximityKm,
    checkIn: toISODate(checkIn),
    checkOut: toISODate(checkOut),
    guests,
    rooms,
    budget,
    budgetType,
    preferences: Array.from(new Set(preferences)),
  };
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T00:00:00`);
  const b = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export function isValidParsedQuery(p: Partial<ParsedQuery> | null | undefined): boolean {
  if (!p) return false;
  if (!p.destination || !p.destination.trim()) return false;
  if (!p.checkIn || !isValidISODate(p.checkIn)) return false;
  if (!p.checkOut || !isValidISODate(p.checkOut)) return false;
  if (new Date(`${p.checkOut}T00:00:00`) <= new Date(`${p.checkIn}T00:00:00`)) return false;
  if (!p.guests || p.guests < 1) return false;
  if (!p.rooms || p.rooms < 1) return false;
  return true;
}

/** Progressively relax a partial parse so the review form always has fallbacks. */
export function normalizeParsedQuery(p: ParsedQuery): ParsedQuery {
  const now = new Date();
  const fallbackIn = toISODate(addDays(now, 14));
  const fallbackOut = toISODate(addDays(now, 16));
  return {
    ...p,
    destination: p.destination?.trim() || "",
    checkIn: isValidISODate(p.checkIn) ? p.checkIn : fallbackIn,
    checkOut: isValidISODate(p.checkOut) ? p.checkOut : fallbackOut,
    guests: Math.max(1, Math.round(p.guests || 2)),
    rooms: Math.max(1, Math.round(p.rooms || 1)),
    budgetType: p.budgetType === "per_night" ? "per_night" : "total",
    preferences: Array.isArray(p.preferences) ? p.preferences.filter(Boolean) : [],
  };
}

/** Build a human friendly summary used by the results and history views. */
export function formatDateRange(checkIn: string, checkOut: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = new Date(`${checkIn}T00:00:00`);
  const b = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${checkIn} – ${checkOut}`;
  return `${months[a.getMonth()]} ${a.getDate()} – ${months[b.getMonth()]} ${b.getDate()}`;
}
