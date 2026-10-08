import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Google Programmable Search, embedded as an additional utility next to Jobi's
 * own hotel research and price comparison.
 *
 * Google's script auto-scans the document for `.gcse-*` elements exactly once,
 * which does not work in a React single-page app: routes mount long after the
 * script has loaded. We therefore request explicit parsing (`parsetags:
 * "explicit"`) and render the element ourselves once the API is available.
 */

/** Programmable Search Engine ID provided for this project. */
const CSE_CX = "67ab5a52c25684950";
const CSE_SCRIPT_SRC = `https://cse.google.com/cse.js?cx=${CSE_CX}`;

/** How long we wait for Google's script before giving up (ms). */
const RENDER_TIMEOUT_MS = 15_000;

interface CseElementApi {
  render: (config: { div: HTMLDivElement; tag: string; gname?: string }) => void;
}

function cseApi(): CseElementApi | undefined {
  const g = (window as { google?: { search?: { cse?: { element?: CseElementApi } } } }).google;
  return g?.search?.cse?.element;
}

export function GoogleSearchBox({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  // Google uses `gname` to identify an element; make it unique per instance.
  const gname = `jobi-${uid.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const render = () => {
      if (cancelled) return;
      const api = cseApi();
      if (api) {
        host.replaceChildren();
        api.render({ div: host, tag: "search", gname });
        return;
      }
      if (Date.now() - startedAt > RENDER_TIMEOUT_MS) return;
      timer = setTimeout(render, 100);
    };

    const startedAt = Date.now();

    // Opt out of Google's one-shot DOM scan before the script loads; React owns
    // the DOM, so we only ever hand Google an empty container div.
    const w = window as typeof window & { __gcse?: { parsetags?: string } };
    if (!w.__gcse) w.__gcse = { parsetags: "explicit" };

    if (cseApi()) {
      render();
    } else {
      const existing = document.querySelector("script[data-jobi-cse]");
      if (!existing) {
        const script = document.createElement("script");
        script.src = CSE_SCRIPT_SRC;
        script.async = true;
        script.dataset.jobiCse = "true";
        document.body.appendChild(script);
      }
      render();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Never leave Google-owned nodes behind for React to reconcile.
      host.replaceChildren();
    };
  }, [gname]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6",
        className,
      )}
    >
      <p className="eyebrow">Search the wider web</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Jobi&apos;s own research and price comparison run above. For everything else, search
        Google&apos;s index directly below.
      </p>
      <div ref={hostRef} className="mt-4 min-h-16" />
    </div>
  );
}

export default GoogleSearchBox;
