/**
 * Booking-link validation.
 *
 * Jobi never trusts a raw URL scraped from the web. A link is only ever shown
 * as a "verified" booking link when it passes every check below. This blocks
 * phishing, javascript:/data: URLs, credential-bearing URLs, IP literals and
 * lookalike provider domains (e.g. booking.com.evil.com).
 */

/** Domains we accept as legitimate booking providers (suffix match, with dot boundary). */
export const PROVIDER_ALLOWLIST: Record<string, string[]> = {
  "Booking.com": ["booking.com"],
  Agoda: ["agoda.com"],
  MakeMyTrip: ["makemytrip.com"],
  Goibibo: ["goibibo.com"],
  Cleartrip: ["cleartrip.com"],
  Yatra: ["yatra.com"],
  Expedia: ["expedia.co.in", "expedia.com"],
  Hotels: ["hotels.com"],
  Trivago: ["trivago.co.in", "trivago.com"],
  OYO: ["oyorooms.com", "oyorooms.co.in"],
  Treebo: ["treebo.com", "treebohotels.com"],
  FabHotels: ["fabhotels.com"],
  IHG: ["ihg.com"],
  Marriott: ["marriott.com"],
  Hilton: ["hilton.com"],
  Radisson: ["radissonhotels.com"],
  "ITC Hotels": ["itchotels.com"],
  "Taj Hotels": ["tajhotels.com"],
  LemonTree: ["lemontreehotels.com"],
  "Sarovar Hotels": ["sarovarhotels.com"],
};

/** Hotel/chain domains that count as an official hotel website. */
const OFFICIAL_HOTEL_DOMAINS = [
  "tajhotels.com",
  "marriott.com",
  "hilton.com",
  "ihg.com",
  "radissonhotels.com",
  "accor.com",
  "hyatt.com",
  "itchotels.com",
  "lemontreehotels.com",
  "sarovarhotels.com",
  "oberoihotels.com",
  "clubmahindra.com",
  "welcomhotel.com",
];

const ALL_ALLOWED = Array.from(
  new Set([...Object.values(PROVIDER_ALLOWLIST).flat(), ...OFFICIAL_HOTEL_DOMAINS]),
);

export interface UrlValidationResult {
  ok: boolean;
  url?: string;
  reason?: string;
  provider?: string;
}

function looksLikeIpOrLocalhost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.includes(":")) return true; // IPv6
  return false;
}

function matchesAllowed(hostname: string): string | undefined {
  for (const domain of ALL_ALLOWED) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return domain;
  }
  return undefined;
}

/** Identify the provider for a validated hostname, if it belongs to an allowlisted provider. */
export function providerForHostname(hostname: string): string | undefined {
  for (const [provider, domains] of Object.entries(PROVIDER_ALLOWLIST)) {
    for (const domain of domains) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return provider;
    }
  }
  if (matchesAllowed(hostname)) return "Official hotel site";
  return undefined;
}

export function validateBookingUrl(raw: string | undefined | null): UrlValidationResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "missing_url" };
  }
  const trimmed = raw.trim();
  if (trimmed.length > 2048) return { ok: false, reason: "too_long" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (parsed.username || parsed.password) return { ok: false, reason: "has_credentials" };

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.includes(".")) return { ok: false, reason: "invalid_host" };
  if (looksLikeIpOrLocalhost(hostname)) return { ok: false, reason: "ip_or_local" };

  const domain = matchesAllowed(hostname);
  if (!domain) return { ok: false, reason: "domain_not_allowlisted" };

  return {
    ok: true,
    url: parsed.toString(),
    provider: providerForHostname(hostname) ?? "Official hotel site",
  };
}

/**
 * Relaxed check used ONLY to decide whether a discovered source page is worth
 * reading further. We still require HTTPS + a real public host.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes(".") || looksLikeIpOrLocalhost(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Strip obvious prompt-injection attempts from untrusted web text before it is shown to a model. */
export function sanitizeUntrustedText(text: string, maxLength = 1200): string {
  if (!text) return "";
  const cleaned = text
    .replace(/\r/g, "")
    // Remove instruction-like lines that try to hijack the agent.
    .replace(/^\s*(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+instructions.*$/gim, "[removed]")
    .replace(/^\s*(system|assistant|developer)\s*:.*$/gim, "[removed]")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
  return cleaned.slice(0, maxLength).trim();
}
