import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { PRICE_DISCLAIMER } from "@/convex/jobi/config";
import { buildMapUrl } from "@/convex/jobi/links";
import { formatDateRange } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Check,
  Circle,
  Clock,
  CreditCard,
  ExternalLink,
  Heart,
  Loader2,
  Lock,
  MapPin,
  SearchX,
  Star,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

const EASE = [0.22, 1, 0.36, 1] as const;

type ResultRow = {
  _id: Id<"searchResults">;
  hotelName: string;
  canonicalHotelName: string;
  providerName: string;
  roomName?: string;
  sourceUrl: string;
  basePrice?: number;
  taxes?: number;
  mandatoryFees?: number;
  totalPrice?: number;
  currency: string;
  priceStatus: string;
  confidence: string;
  mealPlan?: string;
  cancellationPolicy?: string;
  rating?: number;
  imageUrl?: string;
  amenities?: string[];
  isCheapestVerified: boolean;
  savingsVsAverage?: number;
  /** True until a verified payment unlocks the booking link for this search. */
  bookingUrlLocked: boolean;
  metadata?: { notes?: string; sourceDomain?: string; differences?: string[] };
};

function HotelImage({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-accent via-secondary to-background",
          className,
        )}
      >
        <MapPin className="size-6 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

function StageChecklist({
  stages,
}: {
  stages: Array<{ key: string; label: string; status: string }>;
}) {
  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => (
        <motion.li
          key={stage.key}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: index * 0.06 }}
          className="flex items-center gap-3 text-sm"
        >
          {stage.status === "done" ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="size-3" />
            </span>
          ) : stage.status === "active" ? (
            <Loader2 className="size-5 animate-spin text-foreground" />
          ) : (
            <Circle className="size-5 text-muted-foreground/40" />
          )}
          <span
            className={cn(
              stage.status === "pending" ? "text-muted-foreground/60" : "text-foreground",
            )}
          >
            {stage.label}
          </span>
          {stage.status === "active" ? (
            <span className="text-xs text-muted-foreground">in progress…</span>
          ) : null}
        </motion.li>
      ))}
    </ol>
  );
}

function PriceComparison({ results }: { results: ResultRow[] }) {
  const verified = results.filter((r) => r.priceStatus === "verified");
  const observed = results.filter((r) => r.priceStatus !== "verified" && r.totalPrice !== undefined);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6">
      <h3 className="font-editorial text-lg">Price comparison</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Compared on the final total — room, taxes and mandatory fees included.
      </p>

      <div className="mt-5 divide-y divide-border/70 border-y border-border/70">
        {verified.map((row) => (
          <div key={row._id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm">
                {row.providerName}
                <BadgeCheck className="size-3.5 shrink-0 text-emerald-600/80" />
                {row.isCheapestVerified ? (
                  <Badge className="gap-1 bg-emerald-600/90 font-normal text-white hover:bg-emerald-600/90">
                    Best price found
                  </Badge>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.hotelName}</p>
              {row.metadata?.differences?.length ? (
                <ul className="mt-1 space-y-0.5">
                  {row.metadata.differences.slice(0, 3).map((difference) => (
                    <li key={difference} className="text-xs text-amber-600/90">
                      {difference}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-medium tabular-nums">
              {formatMoney(row.totalPrice, row.currency)}
            </p>
          </div>
        ))}
        {observed.map((row) => (
          <div key={row._id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                {row.providerName}
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600/80" />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {row.metadata?.notes ?? "Not verified for your exact dates"}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {formatMoney(row.totalPrice, row.currency)}
            </p>
          </div>
        ))}
      </div>

      {observed.length ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Observed prices come from search results and listings. Jobi could not confirm them for your
          exact dates, guests or room, so they are never treated as the cheapest verified option.
        </p>
      ) : null}
    </div>
  );
}

function ReportCard({ search }: { search: Doc<"searches"> }) {
  const report = search.report;
  const metrics = search.metrics;
  const checked = report?.checkedAt
    ? new Date(report.checkedAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6">
      <h3 className="font-editorial text-lg">Jobi search report</h3>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="eyebrow">Your request</p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li className="text-foreground">{search.parsed.destination}</li>
            <li>{formatDateRange(search.parsed.checkIn, search.parsed.checkOut)}</li>
            <li>
              {search.parsed.guests} guests · {search.parsed.rooms} room
              {search.parsed.rooms > 1 ? "s" : ""}
            </li>
            {search.parsed.budget ? (
              <li>
                Budget {formatMoney(search.parsed.budget)} ·{" "}
                {search.parsed.budgetType === "total" ? "total" : "per night"}
              </li>
            ) : null}
            {search.parsed.preferences.length ? (
              <li>{search.parsed.preferences.join(" · ")}</li>
            ) : null}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Sources checked</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(report?.sourcesChecked ?? []).length ? (
              report?.sourcesChecked.map((source) => (
                <li key={source} className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 text-emerald-600/80" /> {source}
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No sources returned usable offers.</li>
            )}
            {(report?.unavailable ?? []).map((source) => (
              <li key={source} className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-3.5 text-amber-600/80" /> {source}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {metrics ? (
        <>
          <Separator className="my-6" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Offers found", value: metrics.offersFound },
              { label: "Verified", value: metrics.offersVerified },
              { label: "Not verified", value: metrics.offersFound - metrics.offersVerified },
              { label: "Comparable", value: metrics.comparableOffers },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="font-editorial text-2xl">{stat.value}</p>
                <p className="eyebrow mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" /> Checked {checked} IST
            </span>
            <span>{metrics.queriesRun} queries run</span>
            <span>{(metrics.durationMs / 1000).toFixed(1)}s research time</span>
            {metrics.cheapestVerified !== undefined ? (
              <span>Cheapest verified {formatMoney(metrics.cheapestVerified)}</span>
            ) : null}
          </div>
        </>
      ) : null}

      {(report?.limitations ?? []).length ? (
        <ul className="mt-6 space-y-2 border-t border-border/70 pt-5 text-xs leading-5 text-muted-foreground">
          {report?.limitations.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden>·</span>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function SearchDetail() {
  const { id } = useParams<{ id: string }>();
  const searchId = id as Id<"searches">;
  const search = useQuery(api.searches.getSearch, { searchId });
  const results = useQuery(api.searches.getResults, { searchId });
  const favoriteIds = useQuery(api.favorites.favoriteIds, { searchId });
  const toggleFavorite = useMutation(api.favorites.toggleFavorite);
  const revealBookingUrl = useMutation(api.searches.revealBookingUrl);

  // Booking URLs never arrive with the results. They are fetched one-by-one
  // from the server, which re-checks the verified payment before answering.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const handleReveal = async (resultId: Id<"searchResults">) => {
    setRevealing(resultId);
    try {
      const { bookingUrl } = await revealBookingUrl({ resultId });
      setRevealed((prev) => ({ ...prev, [resultId]: bookingUrl }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.split("\n").filter(Boolean).pop() ?? "Could not reveal the booking link."
          : "Could not reveal the booking link.";
      toast.error(message.replace(/^Uncaught (Convex)?Error:\s*/i, ""));
    } finally {
      setRevealing(null);
    }
  };

  if (search === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading search…
        </div>
      </AppShell>
    );
  }

  if (search === null) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <SearchX className="mx-auto size-6 text-muted-foreground" />
          <h1 className="mt-4 font-editorial text-xl">Search not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This search doesn&apos;t exist, or it belongs to another account.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to my searches</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const rows = (results ?? []) as ResultRow[];
  const awaitingPayment = search.status === "created" || search.status === "payment_pending";
  const inProgress = ["paid", "researching", "comparing"].includes(search.status);
  const cheapest = rows.find((row) => row.isCheapestVerified);
  const verifiedRows = rows.filter((r) => r.priceStatus === "verified" && r.totalPrice !== undefined);
  const savings = cheapest?.savingsVsAverage ?? 0;

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          to="/dashboard"
          className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> All searches
        </Link>
        <div className="flex items-center gap-2">
          {search.demoMode ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Demo data
            </Badge>
          ) : null}
          <Badge variant="secondary" className="font-normal capitalize">
            {search.status.replace("_", " ")}
          </Badge>
        </div>
      </div>

      {/* Awaiting payment */}
      {awaitingPayment ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center sm:p-10">
          <CreditCard className="mx-auto size-6 text-muted-foreground" />
          <h1 className="mt-4 font-editorial text-2xl">This search is waiting for payment</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            The ₹10 search fee hasn&apos;t been confirmed yet, so no research has run. Complete
            payment to unlock the deep search for this request.
          </p>
          <Button asChild className="mt-6">
            <Link to="/search">Complete payment</Link>
          </Button>
        </div>
      ) : null}

      {/* Research in progress */}
      {inProgress ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="rounded-xl border border-border bg-card p-6 shadow-frame sm:p-8"
        >
          <p className="eyebrow">Deep search in progress</p>
          <h1 className="mt-3 font-editorial text-3xl">Jobi is searching the web…</h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            {search.parsed.destination} · {formatDateRange(search.parsed.checkIn, search.parsed.checkOut)}{" "}
            · {search.parsed.guests} guests. Real stages below — nothing here is faked.
          </p>
          <div className="mt-8">
            <StageChecklist stages={search.stages} />
          </div>
          <div className="mt-8 space-y-1 border-t border-border/70 pt-6 text-sm text-muted-foreground">
            {["Searching hotel sources…", "Comparing offers…", "Checking prices…", "Checking booking links…", "Finding the cheapest valid option…"].map(
              (line, index) => {
                const activeIndex = search.stages.findIndex((s) => s.status === "active");
                const done = index < (activeIndex === -1 ? search.stages.length : activeIndex);
                return (
                  <p
                    key={line}
                    className={cn(
                      "transition-opacity",
                      done ? "opacity-100" : "opacity-40",
                    )}
                  >
                    {done ? "✓" : "·"} {line}
                  </p>
                );
              },
            )}
          </div>
        </motion.div>
      ) : null}

      {/* Failed */}
      {search.status === "failed" ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center sm:p-10">
          <AlertTriangle className="mx-auto size-6 text-amber-600" />
          <h1 className="mt-4 font-editorial text-2xl">We couldn&apos;t complete this search</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {search.error ?? "Research failed before any results could be verified."}
          </p>
          <Button asChild className="mt-6">
            <Link to="/search">Try a new search</Link>
          </Button>
        </div>
      ) : null}

      {/* Results */}
      {!inProgress && !awaitingPayment && search.status !== "failed" ? (
        <div className="space-y-8">
          {cheapest ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <p className="eyebrow">We found your cheapest verified stay</p>
              <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">
                {cheapest.canonicalHotelName}
              </h1>
            </motion.div>
          ) : (
            <div>
              <p className="eyebrow">Partial result</p>
              <h1 className="mt-3 font-editorial text-3xl">
                We found offers, but couldn&apos;t fully verify a price
              </h1>
            </div>
          )}

          {cheapest ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-frame"
            >
              <div className="grid md:grid-cols-[0.9fr_1.1fr]">
                <HotelImage
                  src={cheapest.imageUrl}
                  className="h-52 w-full md:h-full md:min-h-[280px]"
                />
                <div className="flex flex-col p-6 sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-editorial text-2xl">{cheapest.canonicalHotelName}</h2>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {cheapest.rating ? (
                          <span className="flex items-center gap-1">
                            <Star className="size-3.5 fill-current" /> {cheapest.rating.toFixed(1)}
                          </span>
                        ) : null}
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5" /> {search.parsed.destination}
                          {search.parsed.locality ? ` · ${search.parsed.locality}` : ""}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Save to favourites"
                      onClick={() => void toggleFavorite({ resultId: cheapest._id })}
                      className={cn(
                        "rounded-full border p-2 transition-colors",
                        favoriteIds?.includes(cheapest._id)
                          ? "border-foreground/30 bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Heart
                        className={cn(
                          "size-4",
                          favoriteIds?.includes(cheapest._id) && "fill-current",
                        )}
                      />
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      {formatDateRange(search.parsed.checkIn, search.parsed.checkOut)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" /> {search.parsed.guests} guests
                    </span>
                  </div>

                  <div className="mt-6">
                    <p className="font-editorial text-4xl">
                      {formatMoney(cheapest.totalPrice, cheapest.currency)}
                      <span className="ml-2 align-middle text-sm tracking-normal text-muted-foreground">
                        total
                      </span>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge className="gap-1 bg-emerald-600/90 font-normal text-white hover:bg-emerald-600/90">
                        <BadgeCheck className="size-3.5" /> Best price found
                      </Badge>
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <BadgeCheck className="size-3.5 text-emerald-600/80" /> Verified offer
                      </Badge>
                      {(cheapest.amenities ?? []).slice(0, 4).map((amenity) => (
                        <Badge key={amenity} variant="outline" className="font-normal capitalize">
                          {amenity}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 rounded-lg border border-border/70 bg-background/60 p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Room</span>
                      <span>{formatMoney(cheapest.basePrice, cheapest.currency)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-muted-foreground">Taxes</span>
                      <span>{formatMoney(cheapest.taxes, cheapest.currency)}</span>
                    </div>
                    {cheapest.mandatoryFees ? (
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-muted-foreground">Mandatory fees</span>
                        <span>{formatMoney(cheapest.mandatoryFees, cheapest.currency)}</span>
                      </div>
                    ) : null}
                    <Separator className="my-2.5" />
                    <div className="flex items-center justify-between font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {formatMoney(cheapest.totalPrice, cheapest.currency)}
                      </span>
                    </div>
                    {cheapest.mealPlan ? (
                      <p className="mt-2 text-xs text-muted-foreground">{cheapest.mealPlan}</p>
                    ) : null}
                    {cheapest.cancellationPolicy ? (
                      <p className="text-xs text-muted-foreground">{cheapest.cancellationPolicy}</p>
                    ) : null}
                  </div>

                  <div className="mt-6">
                    {revealed[cheapest._id] ? (
                      <Button asChild size="lg" className="w-full gap-2">
                        <a
                          href={revealed[cheapest._id]}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open {cheapest.providerName} booking page
                          <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="w-full gap-2"
                        disabled={revealing === cheapest._id}
                        onClick={() => void handleReveal(cheapest._id)}
                      >
                        {revealing === cheapest._id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Lock className="size-4" />
                        )}
                        {cheapest.bookingUrlLocked
                          ? "Reveal booking link — ₹10"
                          : "Reveal booking link"}
                      </Button>
                    )}
                    <Button asChild variant="outline" className="mt-2 w-full gap-2">
                      <a
                        href={buildMapUrl({
                          hotelName: cheapest.canonicalHotelName,
                          locality: search.parsed.locality,
                          destination: search.parsed.destination,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MapPin className="size-4" /> View this property on the map
                      </a>
                    </Button>
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      {revealed[cheapest._id]
                        ? `Verified on ${cheapest.providerName} at ${formatMoney(cheapest.totalPrice, cheapest.currency)}. Opens a ${cheapest.providerName} search for this property with your dates.`
                        : "The booking link is kept on the server and only released once your ₹10 payment is verified."}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}

          {savings > 0 && cheapest ? (
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              <div className="bg-card p-5">
                <p className="eyebrow">Average verified alternative</p>
                <p className="mt-2 font-editorial text-2xl">
                  {formatMoney(
                    (cheapest.totalPrice ?? 0) + savings,
                    cheapest.currency,
                  )}
                </p>
              </div>
              <div className="bg-card p-5">
                <p className="eyebrow">Cheapest verified</p>
                <p className="mt-2 font-editorial text-2xl">
                  {formatMoney(cheapest.totalPrice, cheapest.currency)}
                </p>
              </div>
              <div className="bg-accent p-5">
                <p className="eyebrow">You could save</p>
                <p className="mt-2 font-editorial text-2xl">
                  {formatMoney(savings, cheapest.currency)}
                </p>
              </div>
            </div>
          ) : null}

          <PriceComparison results={rows} />

          {verifiedRows.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-muted-foreground">
                Jobi found offers but none could be verified against your exact dates, guests and
                room. We&apos;d rather tell you that than present an unverified price as the cheapest.
                Try widening your dates or budget.
              </p>
            </div>
          ) : null}

          <ReportCard search={search} />

          <div className="rounded-xl border border-border bg-card/60 p-5 text-sm leading-6 text-muted-foreground">
            {PRICE_DISCLAIMER}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
