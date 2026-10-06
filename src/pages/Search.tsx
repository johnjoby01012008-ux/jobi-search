import { AppShell } from "@/components/AppShell";
import { TripSearchBox, type SearchDetails } from "@/components/TripSearchBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isValidISODate,
  isValidParsedQuery,
  normalizeParsedQuery,
  parseTripQuery,
} from "@/convex/jobi/parse";
import type { ParsedQuery } from "@/convex/jobi/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAction, useMutation } from "convex/react";

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const lines = error.message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const last = lines[lines.length - 1] ?? error.message;
    return last.replace(/^Uncaught (Convex)?Error:\s*/i, "") || "Something went wrong.";
  }
  return "Something went wrong. Please try again.";
}
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Loader2,
  MapPin,
  Pencil,
  Search as SearchIcon,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";


export default function Search() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialCheckIn = searchParams.get("checkIn") ?? "";
  const initialCheckOut = searchParams.get("checkOut") ?? "";
  const initialGuests = Number(searchParams.get("guests") ?? "");

  const parseTrip = useAction(api.aiParse.parseTrip);
  const createSearch = useMutation(api.searches.createSearch);

  const [query, setQuery] = useState(initialQuery);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [aiUsed, setAiUsed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState("");

  // Explicit dates/guests from the search box (or the URL) always win over
  // whatever the text parser guessed.
  const applyOverrides = useCallback(
    (parsedQuery: ParsedQuery, details?: SearchDetails) => {
      const next = normalizeParsedQuery(parsedQuery);
      const checkIn = details?.checkIn ?? initialCheckIn;
      const checkOut = details?.checkOut ?? initialCheckOut;
      const guests = details?.guests ?? initialGuests;
      if (isValidISODate(checkIn)) next.checkIn = checkIn;
      if (
        isValidISODate(checkOut) &&
        (!isValidISODate(checkIn) || new Date(checkOut) > new Date(checkIn))
      ) {
        next.checkOut = checkOut;
      }
      if (guests >= 1) next.guests = Math.max(1, Math.round(guests));
      return next;
    },
    [initialCheckIn, initialCheckOut, initialGuests],
  );

  const runParse = useCallback(
    async (text: string, details?: SearchDetails) => {
      setParsing(true);
      try {
        const result = await parseTrip({ query: text });
        setParsed(applyOverrides(result.parsed as ParsedQuery, details));
        setAiUsed(result.aiUsed);
      } catch {
        // The deterministic parser still gives the user something to confirm.
        setParsed(applyOverrides(parseTripQuery(text), details));
        setAiUsed(false);
      } finally {
        setParsing(false);
      }
    },
    [parseTrip, applyOverrides],
  );

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (initialQuery.trim().length >= 3) {
      // Defer the parse out of the effect body (avoids a synchronous state update).
      const timer = window.setTimeout(() => void runParse(initialQuery), 0);
      return () => window.clearTimeout(timer);
    }
  }, [initialQuery, runParse]);

  const valid = useMemo(() => isValidParsedQuery(parsed), [parsed]);

  const update = <K extends keyof ParsedQuery>(key: K, value: ParsedQuery[K]) => {
    setParsed((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const addPreference = () => {
    const value = preferenceDraft.trim();
    if (!value || !parsed) return;
    if (!parsed.preferences.includes(value)) {
      update("preferences", [...parsed.preferences, value]);
    }
    setPreferenceDraft("");
  };

  const handleSearch = async () => {
    if (!parsed || !valid) return;
    setSubmitting(true);
    try {
      const searchId = await createSearch({ query, parsed });
      navigate(`/searches/${searchId}`);
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        {false ? (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                Live web search isn&apos;t connected yet.
              </span>{" "}
              Searches currently run on clearly-labelled demo data. To search real hotel sources,
              start the self-hosted SearXNG service (`docker compose up -d`) and set{" "}
              <span className="font-medium text-foreground">SEARXNG_URL</span> in the project keys.
            </p>
          </div>
        ) : null}

        {!parsed ? (
          <div>
            <p className="eyebrow">New search</p>
            <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">
              Describe your trip in your own words.
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
              Destination, dates, guests, locality and budget. Understanding your request is free,
              and so is the search — Jobi is kept free by the sponsored ads you'll see while it works.
            </p>
            <div className="mt-8">
              <TripSearchBox
                initialValue={query}
                initialCheckIn={initialCheckIn}
                initialCheckOut={initialCheckOut}
                initialGuests={initialGuests >= 1 ? initialGuests : 2}
                autoFocus
                onSubmit={(text, details) => {
                  setQuery(text);
                  void runParse(text, details);
                }}
              />
            </div>
            {parsing ? (
              <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Reading your request…
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="eyebrow">Step 1 · Confirm</p>
              <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">I understood</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {aiUsed
                  ? "Parsed with AI assistance, then validated."
                  : "Parsed by Jobi's deterministic reader."}{" "}
                Correct anything that looks off — accuracy here decides the quality of the search.
              </p>
            </div>

            {/* Free understanding card */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <MapPin className="size-3.5" /> {parsed.destination || "Destination?"}
                  </Badge>
                  {parsed.locality ? (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      {parsed.locality}
                      {parsed.proximityKm ? ` · ${parsed.proximityKm} km` : ""}
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <CalendarDays className="size-3.5" /> {parsed.checkIn} → {parsed.checkOut}
                  </Badge>
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <Users className="size-3.5" /> {parsed.guests} guests · {parsed.rooms} room
                    {parsed.rooms > 1 ? "s" : ""}
                  </Badge>
                  {parsed.budget ? (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Wallet className="size-3.5" /> ₹{parsed.budget.toLocaleString("en-IN")}{" "}
                      {parsed.budgetType === "total" ? "total" : "per night"}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1.5 text-muted-foreground"
                  onClick={() => setEditing((value) => !value)}
                >
                  <Pencil className="size-3.5" />
                  {editing ? "Done" : "Edit"}
                </Button>
              </div>

              {parsed.preferences.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-4">
                  {parsed.preferences.map((pref) => (
                    <span
                      key={pref}
                      className="rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground"
                    >
                      {pref}
                    </span>
                  ))}
                </div>
              ) : null}

              {editing ? (
                <div className="mt-5 grid gap-4 border-t border-border/70 pt-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="destination">City / destination</Label>
                    <Input
                      id="destination"
                      value={parsed.destination}
                      onChange={(e) => update("destination", e.target.value)}
                      placeholder="Goa"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="locality">Area you care about</Label>
                    <Input
                      id="locality"
                      value={parsed.locality ?? ""}
                      onChange={(e) => update("locality", e.target.value || undefined)}
                      placeholder="Baga Beach"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="proximity">How close?</Label>
                    <Select
                      value={parsed.proximityKm ? String(parsed.proximityKm) : "any"}
                      onValueChange={(value) =>
                        update("proximityKm", value === "any" ? undefined : Number(value))
                      }
                    >
                      <SelectTrigger id="proximity">
                        <SelectValue placeholder="Any distance" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any distance</SelectItem>
                        <SelectItem value="1">Within 1 km</SelectItem>
                        <SelectItem value="2">Within 2 km</SelectItem>
                        <SelectItem value="5">Within 5 km</SelectItem>
                        <SelectItem value="10">Within 10 km</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="checkin">Check-in</Label>
                    <Input
                      id="checkin"
                      type="date"
                      value={parsed.checkIn}
                      onChange={(e) => update("checkIn", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="checkout">Check-out</Label>
                    <Input
                      id="checkout"
                      type="date"
                      value={parsed.checkOut}
                      onChange={(e) => update("checkOut", e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="guests">Guests</Label>
                      <Input
                        id="guests"
                        type="number"
                        min={1}
                        value={parsed.guests}
                        onChange={(e) => update("guests", Number(e.target.value) || 1)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rooms">Rooms</Label>
                      <Input
                        id="rooms"
                        type="number"
                        min={1}
                        value={parsed.rooms}
                        onChange={(e) => update("rooms", Number(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="budget">Budget (₹)</Label>
                    <Input
                      id="budget"
                      type="number"
                      min={0}
                      value={parsed.budget ?? ""}
                      onChange={(e) =>
                        update("budget", e.target.value ? Number(e.target.value) : undefined)
                      }
                      placeholder="10000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="budgetType">Budget applies to</Label>
                    <Select
                      value={parsed.budgetType}
                      onValueChange={(value) =>
                        update("budgetType", value as ParsedQuery["budgetType"])
                      }
                    >
                      <SelectTrigger id="budgetType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="total">Whole stay</SelectItem>
                        <SelectItem value="per_night">Per night</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pref">Preferences</Label>
                    <div className="flex gap-2">
                      <Input
                        id="pref"
                        value={preferenceDraft}
                        onChange={(e) => setPreferenceDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPreference();
                          }
                        }}
                        placeholder="pool, breakfast, sea view…"
                      />
                      <Button type="button" variant="outline" onClick={addPreference}>
                        Add
                      </Button>
                    </div>
                    {parsed.preferences.length ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {parsed.preferences.map((pref) => (
                          <button
                            key={pref}
                            type="button"
                            onClick={() =>
                              update(
                                "preferences",
                                parsed.preferences.filter((p) => p !== pref),
                              )
                            }
                            className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground"
                          >
                            {pref}
                            <X className="size-3" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {!valid ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="text-muted-foreground">
                  Jobi needs a destination and a valid date range before it can search. Tap{" "}
                  <span className="font-medium text-foreground">Edit</span> to add them.
                </p>
              </div>
            ) : null}

            {/* Free search card (no payment, no Razorpay) */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="font-editorial text-xl">Find me the cheapest hotel</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    Jobi will search multiple permitted sources and compare available offers for your
                    exact dates, guests and requirements — then show you the cheapest verified option
                    it can find.
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-editorial text-3xl">Free</p>
                  <p className="eyebrow mt-1">no search fee</p>
                </div>
              </div>

              <ul className="mt-6 space-y-2 border-t border-border/70 pt-5 text-sm text-muted-foreground">
                {[
                  "Search permitted hotel and booking sources",
                  "Normalise and match the same hotel across providers",
                  "Compare final totals including taxes and fees",
                  "Rank only the offers Jobi can verify",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-600/80" />
                    {line}
                  </li>
                ))}
              </ul>

              <Button
                className="mt-6 w-full gap-2"
                size="lg"
                disabled={!valid || submitting}
                onClick={handleSearch}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SearchIcon className="size-4" />
                )}
                Find My Cheapest Stay — Free
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Free search — a sponsored ad appears while Jobi researches, and again between the
                results.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setParsed(null);
                setEditing(false);
              }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <SearchIcon className="size-3.5" />
              Start over
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
