import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ArrowRight, CalendarDays, Sparkles, Users } from "lucide-react";
import { useState } from "react";

const EXAMPLES = [
  "Goa for 3 nights, 2 people, near Baga Beach, with a pool, under ₹10k total",
  "Boutique stay in Jaipur for 2, Dec 12–15, under ₹8,000",
  "Family hotel in Manali, 4 guests, 5 nights, mountain view, under ₹15k",
];

/** Explicit details the user can pin down before searching. */
export interface SearchDetails {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function TripSearchBox({
  onSubmit,
  initialValue = "",
  initialCheckIn = "",
  initialCheckOut = "",
  initialGuests = 2,
  autoFocus = false,
  className,
}: {
  onSubmit: (query: string, details: SearchDetails) => void;
  initialValue?: string;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests);
  // Only send guests when the user actually touched the field, so a party size
  // written in the message ("4 guests") is not silently overwritten by the default.
  const [guestsEdited, setGuestsEdited] = useState(false);

  const today = toISODate(new Date());

  const handleCheckIn = (next: string) => {
    setCheckIn(next);
    // Keep check-out strictly after check-in so the parser always gets a valid range.
    if (next && (!checkOut || checkOut <= next)) {
      setCheckOut(toISODate(addDays(new Date(`${next}T00:00:00`), 2)));
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    onSubmit(trimmed, {
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      guests: guestsEdited ? Math.max(1, Math.min(20, Math.round(guests) || 2)) : undefined,
    });
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="rounded-xl border border-border bg-card p-2 shadow-frame">
        <label htmlFor="trip-query" className="sr-only">
          Describe your trip
        </label>
        <textarea
          id="trip-query"
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="“Goa for 3 nights, 2 people, near Baga Beach, with a pool, under ₹10k”"
          className="w-full resize-none bg-transparent px-3 py-3 text-[0.95rem] leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />

        {/* Dates + guests — pin these down to sharpen the search */}
        <div className="grid gap-3 border-t border-border/70 px-3 pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="trip-check-in" className="flex items-center gap-1.5 text-xs">
              <CalendarDays className="size-3.5" /> Check-in
            </Label>
            <Input
              id="trip-check-in"
              type="date"
              value={checkIn}
              min={today}
              onChange={(event) => handleCheckIn(event.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-check-out" className="flex items-center gap-1.5 text-xs">
              <CalendarDays className="size-3.5" /> Check-out
            </Label>
            <Input
              id="trip-check-out"
              type="date"
              value={checkOut}
              min={checkIn || today}
              onChange={(event) => setCheckOut(event.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-guests" className="flex items-center gap-1.5 text-xs">
              <Users className="size-3.5" /> Guests
            </Label>
            <Input
              id="trip-guests"
              type="number"
              min={1}
              max={20}
              value={guests}
              onChange={(event) => {
                setGuestsEdited(true);
                setGuests(Number(event.target.value) || 1);
              }}
              className="h-9 sm:w-24"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/70 px-3 pt-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {EXAMPLES.map((example, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setValue(example)}
                className="rounded-full border border-border/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                {index === 0 ? "Goa · pool · ₹10k" : index === 1 ? "Jaipur · weekend" : "Manali · family"}
              </button>
            ))}
          </div>
          <Button
            type="button"
            onClick={submit}
            disabled={value.trim().length < 3}
            className="shrink-0 gap-2"
          >
            <Sparkles className="size-4" />
            Search with Jobi
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        Add your dates for sharper results — or leave them blank and Jobi will read them from your
        message. Understanding your request and the deep search are both free — Jobi is supported by a small sponsored ad.
      </p>
    </div>
  );
}
