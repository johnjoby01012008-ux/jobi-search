/**
 * HTTP client for the Python extraction service.
 *
 * The Convex backend calls this from an internalAction, so the extractor URL
 * is never exposed to the browser. The extractor itself enforces SSRF, so we
 * only pass already-validated URLs.
 */

import type {
  ExtractionBackendConfig,
  ExtractBatchRequest,
  ExtractBatchResult,
  ExtractionResult,
  PriceAmount,
  PriceContext,
  ExtractedHotel,
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_URLS_PER_BATCH = 30;

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveExtractionBackendConfig(
  env: Record<string, string | undefined>,
): ExtractionBackendConfig | null {
  const raw = env.BACKEND_EXTRACTOR_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return {
      baseUrl: parsed.origin,
      timeoutMs: readNumber(env.EXTRACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      maxUrlsPerBatch: readNumber(
        env.EXTRACTION_MAX_URLS_PER_BATCH,
        DEFAULT_MAX_URLS_PER_BATCH,
      ),
      enabled: true,
    };
  } catch {
    return null;
  }
}

interface ExtractBatchResponse {
  successful: Array<{
    success: boolean;
    hotel: Record<string, unknown> | null;
    reason: string | null;
    jsonld_found: boolean;
    playwright_used: boolean;
    notes: Record<string, unknown>;
  }>;
  failed: Array<{
    url: string;
    reason: string;
    status_code?: number;
    jsonld_found?: boolean;
  }>;
  elapsed_seconds: number;
}

export async function extractBatch(
  config: ExtractionBackendConfig,
  request: ExtractBatchRequest,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ExtractBatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(`${config.baseUrl}/extract-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ExtractionServiceError(
        `extraction backend returned ${response.status}`,
        response.status,
        body,
      );
    }

    const payload = (await response.json()) as ExtractBatchResponse;
    return {
      successful: payload.successful.map(mapSuccessful),
      failed: payload.failed,
      elapsed_seconds: payload.elapsed_seconds,
    };
  } catch (error) {
    if (error instanceof ExtractionServiceError) throw error;
    throw new ExtractionServiceError(
      error instanceof Error ? error.message : "extraction backend request failed",
      0,
      {},
    );
  } finally {
    clearTimeout(timer);
  }
}

function mapSuccessful(
  raw: ExtractBatchResponse["successful"][number],
): ExtractionResult {
  return {
    success: raw.success,
    hotel: raw.hotel
      ? {
          hotel_name: raw.hotel.hotel_name as string,
          provider: raw.hotel.provider as string,
          room_name: raw.hotel.room_name as string | null,
          check_in: raw.hotel.check_in as string,
          check_out: raw.hotel.check_out as string,
          guests: raw.hotel.guests as number,
          rooms: raw.hotel.rooms as number,
          price: raw.hotel.price as PriceAmount,
          price_context: raw.hotel.price_context as PriceContext,
          taxes: raw.hotel.taxes as number | null,
          total_price: raw.hotel.total_price as number | null,
          breakfast_included: raw.hotel.breakfast_included as boolean | null,
          free_cancellation: raw.hotel.free_cancellation as boolean | null,
          cancellation_text: raw.hotel.cancellation_text as string | null,
          availability: raw.hotel.availability as ExtractedHotel["availability"] | null,
          booking_url: raw.hotel.booking_url as string,
          source_url: raw.hotel.source_url as string,
          price_verified: raw.hotel.price_verified as boolean,
          confidence: raw.hotel.confidence as ExtractedHotel["confidence"],
          rating: raw.hotel.rating as number | null,
          address: raw.hotel.address as string | null,
          amenities: raw.hotel.amenities as string[],
          description: raw.hotel.description as string | null,
          extracted_at: raw.hotel.extracted_at as string,
        }
      : null,
    reason: raw.reason as ExtractionResult["reason"],
    observed_prices: [],
    jsonld_found: raw.jsonld_found,
    playwright_used: raw.playwright_used,
    notes: raw.notes,
  };
}

export class ExtractionServiceError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    body: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExtractionServiceError";
    this.status = status;
    this.body = body;
  }
}
