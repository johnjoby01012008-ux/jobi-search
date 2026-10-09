/**
 * Extraction stage for the research pipeline.
 *
 * After the search provider returns candidate URLs, this stage:
 * 1. Filters URLs through SSRF-safe validation.
 * 2. Sends batches to the Python extraction backend.
 * 3. Converts extracted hotels back into RawSearchResult entries so they flow
 *    through the existing normalize → dedupe → compare → verify pipeline.
 *
 * When the extraction backend is not configured, this is a no-op: the pipeline
 * continues with search-result-only offers (which are always OBSERVED, never
 * VERIFIED).
 */

import type { RawSearchResult } from "../types";
import { sanitizeUntrustedText, isPublicHttpsUrl } from "../urlSafety";
import { extractOffers, extractFailedEntries } from "./normalize";
import type { ExtractBatchResult, ExtractionResult } from "./types";
import { resolveExtractionBackendConfig, extractBatch, ExtractionServiceError } from "./fetch";

interface ExtractionStageResult {
  extractedOffers: RawSearchResult[];
  failedUrls: Array<{ url: string; reason: string }>;
  extractionUsed: boolean;
}

/**
 * Run extraction on the URLs discovered by the search provider.
 *
 * `rawResults` may include both search-result entries (snippet-based) and
 * already-extracted entries. We only extract URLs that look like real public
 * hotel/booking pages and that came from a search result (have a `url` field).
 */
export async function runExtractionStage(
  rawResults: RawSearchResult[],
  parsed: {
    checkIn: string;
    checkOut: string;
    guests: number;
    rooms: number;
  },
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<ExtractionStageResult> {
  const config = resolveExtractionBackendConfig(process.env);
  if (!config?.enabled) {
    return { extractedOffers: [], failedUrls: [], extractionUsed: false };
  }

  // Collect unique URLs that are worth extracting.
  const urlSet = new Set<string>();
  for (const result of rawResults) {
    const url = result.url;
    if (!url) continue;
    if (!isPublicHttpsUrl(url)) continue;
    if (urlSet.has(url)) continue;
    urlSet.add(url);
  }

  const urls = Array.from(urlSet);
  if (urls.length === 0) {
    return { extractedOffers: [], failedUrls: [], extractionUsed: false };
  }

  // Cap to maxUrlsPerBatch.
  const capped = urls.slice(0, config.maxUrlsPerBatch);

  const request = {
    urls: capped,
    check_in: parsed.checkIn,
    check_out: parsed.checkOut,
    guests: parsed.guests,
    rooms: parsed.rooms,
    timeout_seconds: Math.round(config.timeoutMs / 1000),
  };

  let batchResult: ExtractBatchResult;
  try {
    batchResult = await extractBatch(config, request, fetchImpl);
  } catch (error) {
    const message = error instanceof ExtractionServiceError ? error.message : "extraction backend error";
    console.log(
      JSON.stringify({
        event: "extraction_stage_failed",
        urlsConsidered: capped.length,
        reason: message,
      }),
    );
    return {
      extractedOffers: [],
      failedUrls: capped.map((url) => ({ url, reason: message })),
      extractionUsed: false,
    };
  }

  // Convert successful extractions into RawSearchResult entries.
  const extractedOffers: RawSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const result of batchResult.successful) {
    if (!result.success || !result.hotel) continue;
    const hotel = result.hotel;
    if (!hotel) continue;

    // Skip if we already have this URL from search.
    const sourceUrl = hotel.source_url;
    if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
    const hotelName = hotel.hotel_name ?? sourceUrl;
    const roomName = hotel.room_name ?? undefined;
    seenUrls.add(sourceUrl);

    const providerName = hotel.provider || "Unknown provider";
    const snippet = buildSnippet(hotel);

    extractedOffers.push({
      title: sanitizeUntrustedText(hotelName, 200) || sourceUrl,
      url: sourceUrl,
      snippet,
      source: new URL(sourceUrl).hostname,
      providerName,
      hotelName: hotelName,
      roomName: roomName,
      basePrice: hotel.price?.amount ?? undefined,
      taxes: hotel.taxes ?? undefined,
      mandatoryFees: undefined,
      totalPrice: hotel.total_price ?? hotel.price?.amount ?? undefined,
      currency: hotel.price?.currency ?? "INR",
      mealPlan: hotel.breakfast_included ? "Breakfast included" : undefined,
      cancellationPolicy: hotel.cancellation_text ?? undefined,
      priceStatus: hotel.price_verified ? "verified" : "observed",
      confidence: hotel.confidence,
      rating: hotel.rating ?? undefined,
      amenities: hotel.amenities.length ? hotel.amenities : undefined,
      notes: buildNotes(hotel),
      bookingUrl: sourceUrl,
    });
  }

  // Collect failures.
  const failedUrls = batchResult.failed.map((f) => ({
    url: f.url,
    reason: f.reason,
  }));

  // Also add URLs that were in the request but not in successful OR failed
  // (shouldn't happen, but be safe).
  const accounted = new Set<string>();
  for (const r of batchResult.successful) {
    if (r.success && r.hotel?.source_url) accounted.add(r.hotel.source_url);
  }
  for (const f of batchResult.failed) accounted.add(f.url);
  for (const url of capped) {
    if (!accounted.has(url)) {
      failedUrls.push({ url, reason: "no_response" });
    }
  }

  console.log(
    JSON.stringify({
      event: "extraction_stage_ok",
      urlsConsidered: capped.length,
      extractedOffers: extractedOffers.length,
      failedUrls: failedUrls.length,
      extractionUsed: true,
    }),
  );

  return {
    extractedOffers,
    failedUrls,
    extractionUsed: true,
  };
}

function buildSnippet(hotel: ExtractionResult["hotel"]): string {
  const parts: string[] = [];
  if (!hotel) return "Hotel page";
  if (hotel.hotel_name) parts.push(hotel.hotel_name);
  if (hotel.room_name) parts.push(`${hotel.room_name} room`);
  if (hotel.price) {
    parts.push(`${hotel.price.currency} ${hotel.price.amount.toLocaleString("en-IN")}`);
    if (hotel.price_context?.price_type) {
      parts.push(`(${hotel.price_context.price_type})`);
    }
  }
  if (hotel.rating) parts.push(`⭐ ${hotel.rating.toFixed(1)}`);
  if (hotel.breakfast_included) parts.push("Breakfast included");
  if (hotel.free_cancellation) parts.push("Free cancellation");
  if (hotel.amenities.length) {
    parts.push(hotel.amenities.slice(0, 3).join(", "));
  }
  return sanitizeUntrustedText(parts.join(" · ") || "Hotel page", 600);
}

function buildNotes(hotel: ExtractionResult["hotel"]): string | undefined {
  if (!hotel) return undefined;
  const parts: string[] = [];
  if (hotel.price_verified) {
    parts.push("Price verified from structured page data.");
  } else {
    parts.push("Price extracted from the page — not verified for your exact dates.");
  }
  if (hotel.price_context?.price_type === "starting_from") {
    parts.push("Listed as starting-from price.");
  }
  if (hotel.confidence === "low") {
    parts.push("Low extraction confidence — treat as indicative.");
  }
  return parts.length ? parts.join(" ") : undefined;
}
