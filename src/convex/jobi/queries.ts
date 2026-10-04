import type { ParsedQuery } from "./types";
import { RESEARCH_BUDGET } from "./config";

/** Format an ISO date like "December 12 2026" for search engines. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Generate several query variations from the user's request. Queries are built
 * dynamically — never hard-coded to a destination — and always capped by the
 * research budget.
 */
export function generateQueries(
  parsed: ParsedQuery,
  limit: number = RESEARCH_BUDGET.maxQueries,
): string[] {
  const { destination, locality, checkIn, checkOut, guests, rooms, budget, budgetType, preferences } = parsed;
  const ci = longDate(checkIn);
  const co = longDate(checkOut);
  const prefs = preferences.filter((p) => !p.endsWith("nights")).slice(0, 3);
  const prefText = prefs.join(" ");

  const queries: string[] = [];

  queries.push(`${destination} hotels ${ci} ${co} ${guests} guests price`);
  if (locality) {
    queries.push(
      `${locality} ${destination} hotels ${ci} ${co} ${guests} adults price per night`,
    );
    queries.push(`hotels near ${locality} ${destination} ${prefText}`.trim());
  }
  queries.push(`${destination} hotel booking ${ci} ${co} total price ${rooms} room`);

  if (budget) {
    const unit = budgetType === "total" ? "total" : "per night";
    queries.push(`${destination} hotel under ₹${budget} ${unit} ${prefs.join(" ")}`.trim());
  }

  for (const pref of prefs) {
    queries.push(`${destination} hotel ${pref} ${ci} ${co}`);
  }

  queries.push(`${destination} hotels ${guests} adults ${prefs.join(" ")} booking sites`);
  queries.push(`site:booking.com ${destination} hotels ${ci}`);
  queries.push(`site:agoda.com ${destination} hotels ${ci}`);
  queries.push(`site:makemytrip.com ${destination} hotels ${ci}`);

  // Deduplicate while preserving order and respecting the cap.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of queries) {
    const normalized = q.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}
