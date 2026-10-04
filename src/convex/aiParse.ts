"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { normalizeParsedQuery, parseTripQuery } from "./jobi/parse";
import { sanitizeUntrustedText } from "./jobi/urlSafety";
import type { ParsedQuery } from "./jobi/types";

/**
 * AI is used ONLY to understand the natural-language request. The deterministic
 * parser runs first and is always the fallback, so the product works with or
 * without an AI key. The AI's output is validated field-by-field and can never
 * override a well-formed deterministic value with nonsense.
 */

const SYSTEM_PROMPT = `You extract structured hotel search intent. Return ONLY compact JSON with keys:
destination (string), locality (string|null), proximityKm (number|null),
checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), guests (integer), rooms (integer),
budget (number|null, INR), budgetType ("total"|"per_night"), preferences (string[]).
Do not add commentary. If a value is unknown, use null.`;

async function tryAiParse(raw: string): Promise<Partial<ParsedQuery> | null> {
  if (!process.env.VLY_INTEGRATION_KEY) return null;
  try {
    const { vly } = await import("../lib/vly-integrations");
    const safe = sanitizeUntrustedText(raw, 800);
    const result = await vly.ai.completion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: safe },
      ],
      temperature: 0,
      maxTokens: 300,
    });
    if (!result?.success || !result.data) return null;
    const content = result.data.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const out: Partial<ParsedQuery> = {};
    if (typeof parsed.destination === "string" && parsed.destination.trim()) {
      out.destination = parsed.destination.trim();
    }
    if (typeof parsed.locality === "string" && parsed.locality.trim()) {
      out.locality = parsed.locality.trim();
    }
    if (typeof parsed.proximityKm === "number") out.proximityKm = parsed.proximityKm;
    if (typeof parsed.checkIn === "string") out.checkIn = parsed.checkIn;
    if (typeof parsed.checkOut === "string") out.checkOut = parsed.checkOut;
    if (typeof parsed.guests === "number") out.guests = parsed.guests;
    if (typeof parsed.rooms === "number") out.rooms = parsed.rooms;
    if (typeof parsed.budget === "number") out.budget = parsed.budget;
    if (parsed.budgetType === "total" || parsed.budgetType === "per_night") {
      out.budgetType = parsed.budgetType;
    }
    if (Array.isArray(parsed.preferences)) {
      out.preferences = parsed.preferences.filter((p): p is string => typeof p === "string");
    }
    return out;
  } catch {
    return null;
  }
}

/** Merge AI output over the deterministic parse, only when the AI value is valid. */
function mergeParsed(base: ParsedQuery, ai: Partial<ParsedQuery>): ParsedQuery {
  const dateOk = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());

  const checkIn = dateOk(ai.checkIn) ? ai.checkIn : base.checkIn;
  let checkOut = dateOk(ai.checkOut) ? ai.checkOut : base.checkOut;
  if (new Date(`${checkOut}T00:00:00`) <= new Date(`${checkIn}T00:00:00`)) {
    checkOut = base.checkOut;
  }

  return {
    destination: ai.destination?.trim() || base.destination,
    locality: ai.locality?.trim() || base.locality,
    proximityKm: typeof ai.proximityKm === "number" ? ai.proximityKm : base.proximityKm,
    checkIn,
    checkOut,
    guests: typeof ai.guests === "number" && ai.guests >= 1 ? Math.round(ai.guests) : base.guests,
    rooms: typeof ai.rooms === "number" && ai.rooms >= 1 ? Math.round(ai.rooms) : base.rooms,
    budget: typeof ai.budget === "number" && ai.budget > 0 ? ai.budget : base.budget,
    budgetType: ai.budgetType ?? base.budgetType,
    preferences: ai.preferences?.length ? Array.from(new Set([...ai.preferences, ...base.preferences])) : base.preferences,
  };
}

export const parseTrip = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }) => {
    const base = normalizeParsedQuery(parseTripQuery(query));
    const ai = await tryAiParse(query);
    return {
      parsed: ai ? mergeParsed(base, ai) : base,
      aiUsed: ai !== null,
    };
  },
});
