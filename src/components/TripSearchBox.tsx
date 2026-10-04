import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";

const EXAMPLES = [
  "Goa for 3 nights, 2 people, near Baga Beach, with a pool, under ₹10k total",
  "Boutique stay in Jaipur for 2, Dec 12–15, under ₹8,000",
  "Family hotel in Manali, 4 guests, 5 nights, mountain view, under ₹15k",
];

export function TripSearchBox({
  onSubmit,
  initialValue = "",
  autoFocus = false,
  className,
}: {
  onSubmit: (query: string) => void;
  initialValue?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    onSubmit(trimmed);
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
        Understanding your request is free. You only pay ₹10 when you unlock the deep search.
      </p>
    </div>
  );
}
