import { cn } from "@/lib/utils";

/**
 * AdSlot — the single place where ads may render in Jobi.
 *
 * Key invariants (never break these):
 * - Ads never affect hotel ranking, ordering or "cheapest" selection. They are
 *   purely cosmetic placeholders placed *between* result rows.
 * - Gates on `VITE_ADS_ENABLED` so an operator can disable the ad system
 *   completely with no code changes. Defaults to `false`.
 * - The "Sponsored" label is always visible; never hide it.
 */
export function AdSlot({
  variant = "inline",
  className,
}: {
  /** "banner" renders a small strip; "inline" renders a medium card. */
  variant?: "banner" | "inline";
  className?: string;
}) {
  // Gated by the env var — set VITE_ADS_ENABLED=true to turn the ad slot on.
  const adsEnabled =
    import.meta.env.VITE_ADS_ENABLED === "true" || import.meta.env.VITE_ADS_ENABLED === "1";

  if (!adsEnabled) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/25 bg-amber-500/5",
        variant === "banner" ? "p-3" : "p-5 shadow-frame",
        className,
      )}
      role="complementary"
      aria-label="Sponsored content"
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 pb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Sponsored
        </span>
        <span className="text-[10px] text-muted-foreground">Ad</span>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-background/70 p-3">
        {/* Replace this creative with your ad network SDK / markup. */}
        <p className="text-sm font-medium text-foreground">
          {variant === "banner" ? "Book smarter, not harder." : "Your next stay, sorted."}
        </p>
        {variant === "inline" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Clearly labelled placements keep Jobi Search free — never part of the price ranking.
          </p>
        )}
      </div>
    </div>
  );
}
