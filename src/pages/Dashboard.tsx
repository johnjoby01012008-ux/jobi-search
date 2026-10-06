import { AppShell } from "@/components/AppShell";
import { HotelImage } from "@/components/HotelImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { formatDateRange } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { ArrowRight, Heart, Loader2, Plus, Search as SearchIcon } from "lucide-react";
import { Link } from "react-router";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-800",
  confirmed: "bg-emerald-500/10 text-emerald-800",
  partial: "bg-amber-500/10 text-amber-800",
  reserved: "bg-amber-500/10 text-amber-800",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-secondary text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
        STATUS_STYLES[status] ?? "bg-secondary text-muted-foreground",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <p className="font-editorial text-lg">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? (
        <Button asChild className="mt-5 gap-2">
          <Link to={action.to}>
            <Plus className="size-4" /> {action.label}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const bookings = useQuery(api.bookings.listMine);
  const searches = useQuery(api.searches.listSearches);
  const favorites = useQuery(api.favorites.listFavorites);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Your account</p>
          <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">
            Welcome back{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your reservations, price searches and saved stays in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link to="/search">
              <SearchIcon className="size-4" /> Price search
            </Link>
          </Button>
          <Button asChild className="gap-2">
            <Link to="/hotels">
              <Plus className="size-4" /> Book a stay
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="reservations" className="mt-10">
        <TabsList>
          <TabsTrigger value="reservations">
            Reservations{bookings && bookings.length > 0 ? ` (${bookings.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="searches">
            Price searches{searches && searches.length > 0 ? ` (${searches.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="saved">
            Saved stays{favorites && favorites.length > 0 ? ` (${favorites.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Reservations */}
        <TabsContent value="reservations" className="mt-6">
          {bookings === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading your reservations…
            </div>
          ) : bookings.length === 0 ? (
            <EmptyState
              title="No reservations yet"
              body="Browse the collection and reserve a stay. We hold the dates and take you to the property to pay."
              action={{ label: "Browse properties", to: "/hotels" }}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {bookings.map((booking) => (
                <Link
                  key={booking._id}
                  to={`/bookings/${booking._id}`}
                  className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/25"
                >
                  <HotelImage src={booking.imageUrl} className="aspect-[16/7] w-full" />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-editorial text-lg leading-snug">{booking.hotelName}</h2>
                      <StatusPill status={booking.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {booking.locality} · {booking.destination}
                    </p>
                    <div className="mt-4 flex items-end justify-between gap-4 border-t border-border/70 pt-4">
                      <div className="text-sm">
                        <p>{formatDateRange(booking.checkIn, booking.checkOut)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {booking.guests} {booking.guests === 1 ? "guest" : "guests"} ·{" "}
                          {booking.reference}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-editorial text-lg tabular-nums">
                          {formatMoney(booking.totalPrice, booking.currency)}
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Price searches */}
        <TabsContent value="searches" className="mt-6">
          {searches === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading your searches…
            </div>
          ) : searches.length === 0 ? (
            <EmptyState
              title="No price searches yet"
              body="Describe a trip and Jobi researches permitted booking sources for free, then reports the cheapest verified total. A sponsored ad appears while it works."
              action={{ label: "Start a price search", to: "/search" }}
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {searches.map((search) => (
                <Link
                  key={search._id}
                  to={`/searches/${search._id}`}
                  className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/60"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-editorial text-lg">{search.parsed.destination}</p>
                      <StatusPill status={search.status} />
                      {search.demoMode ? (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                          Demo
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {formatDateRange(search.parsed.checkIn, search.parsed.checkOut)} ·{" "}
                      {search.parsed.guests} guests
                      {search.parsed.budget
                        ? ` · budget ${formatMoney(search.parsed.budget)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {search.metrics?.cheapestVerified !== undefined ? (
                      <div className="hidden text-right sm:block">
                        <p className="eyebrow">Cheapest verified</p>
                        <p className="text-sm font-medium tabular-nums">
                          {formatMoney(search.metrics.cheapestVerified)}
                        </p>
                      </div>
                    ) : null}
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Saved stays */}
        <TabsContent value="saved" className="mt-6">
          {favorites === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading saved stays…
            </div>
          ) : favorites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
              <Heart className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-editorial text-lg">Nothing saved yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Save a verified offer from a price search and it will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {favorites.map((favorite) => (
                <Link
                  key={favorite._id}
                  to={`/searches/${favorite.searchId}`}
                  className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/25"
                >
                  <p className="font-editorial text-lg">{favorite.hotelName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {favorite.providerName} · {formatMoney(favorite.totalPrice, favorite.currency)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
