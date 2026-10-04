import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatDateRange } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { ArrowRight, Heart, Loader2, Plus, Search as SearchIcon } from "lucide-react";
import { Link } from "react-router";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-700",
  partial: "bg-amber-500/10 text-amber-700",
  failed: "bg-destructive/10 text-destructive",
  researching: "bg-secondary text-muted-foreground",
  comparing: "bg-secondary text-muted-foreground",
  paid: "bg-secondary text-muted-foreground",
  payment_pending: "bg-secondary text-muted-foreground",
  created: "bg-secondary text-muted-foreground",
};

export default function Dashboard() {
  const { user } = useAuth();
  const searches = useQuery(api.searches.listSearches);
  const favorites = useQuery(api.favorites.listFavorites);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">
            Welcome{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every paid search, its verified cheapest result and the sources we checked.
          </p>
        </div>
        <Button asChild className="gap-2 self-start">
          <Link to="/search">
            <Plus className="size-4" /> New search
          </Link>
        </Button>
      </div>

      <section className="mt-10">
        <h2 className="eyebrow">Search history</h2>
        {searches === undefined ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your searches…
          </div>
        ) : searches.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
            <SearchIcon className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 font-editorial text-lg">No searches yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Describe a trip and Jobi will research it across permitted sources for ₹10.
            </p>
            <Button asChild className="mt-5 gap-2">
              <Link to="/search">
                <Plus className="size-4" /> Start your first search
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {searches.map((search) => {
              const cheapest = search.metrics?.cheapestVerified;
              return (
                <Link
                  key={search._id}
                  to={`/searches/${search._id}`}
                  className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/60"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-editorial text-lg">{search.parsed.destination}</p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                          STATUS_STYLES[search.status] ?? "bg-secondary text-muted-foreground",
                        )}
                      >
                        {search.status.replace("_", " ")}
                      </span>
                      {search.demoMode ? (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                          Demo
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {formatDateRange(search.parsed.checkIn, search.parsed.checkOut)} ·{" "}
                      {search.parsed.guests} guests
                      {search.parsed.budget ? ` · budget ${formatMoney(search.parsed.budget)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {cheapest !== undefined ? (
                      <div className="hidden text-right sm:block">
                        <p className="eyebrow">Cheapest verified</p>
                        <p className="text-sm font-medium tabular-nums">{formatMoney(cheapest)}</p>
                      </div>
                    ) : null}
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {favorites && favorites.length > 0 ? (
        <section className="mt-12">
          <h2 className="eyebrow flex items-center gap-2">
            <Heart className="size-3.5" /> Saved stays
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {favorites.map((fav) => (
              <Link
                key={fav._id}
                to={`/searches/${fav.searchId}`}
                className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-secondary/60"
              >
                <p className="font-editorial text-lg">{fav.hotelName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {fav.providerName} · {formatMoney(fav.totalPrice, fav.currency)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
