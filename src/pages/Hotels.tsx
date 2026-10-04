import { AppShell } from "@/components/AppShell";
import { PropertyCard } from "@/components/PropertyCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useEnsureCatalog } from "@/hooks/use-catalog";
import { useQuery } from "convex/react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

type SortOption = "rating" | "price" | "name";

export default function Hotels() {
  useEnsureCatalog();

  const [search, setSearch] = useState("");
  const [destination, setDestination] = useState<string>("all");
  const [sort, setSort] = useState<SortOption>("rating");

  const destinations = useQuery(api.hotels.destinations);
  const hotels = useQuery(api.hotels.list, {
    search: search.trim() || undefined,
    destination: destination === "all" ? undefined : destination,
    sort,
  });

  const resetFilters = () => {
    setSearch("");
    setDestination("all");
    setSort("rating");
  };

  return (
    <AppShell>
      <header className="max-w-3xl">
        <p className="eyebrow">The collection</p>
        <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">Browse properties</h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          A short, deliberately curated list of properties across India. Every entry is reviewed by
          our team and priced with the property&apos;s own published rates, so the number you see is
          the number you discuss at the desk.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by property, city, or amenity"
            className="pl-9"
            aria-label="Search properties"
          />
        </div>
        <div className="flex items-center gap-3">
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger className="w-[190px]" aria-label="Filter by destination">
              <SelectValue placeholder="All destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All destinations</SelectItem>
              {(destinations ?? []).map((entry) => (
                <SelectItem key={entry.destination} value={entry.destination}>
                  {entry.destination} ({entry.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as SortOption)}>
            <SelectTrigger className="w-[160px]" aria-label="Sort properties">
              <SlidersHorizontal className="mr-2 size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rating">Top rated</SelectItem>
              <SelectItem value="price">Lowest price</SelectItem>
              <SelectItem value="name">Alphabetical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className="mt-8">
        {hotels === undefined ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-3 p-5">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : hotels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <h2 className="font-editorial text-xl">No properties match those filters</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Try a different destination or clear the search term to see the full collection.
            </p>
            <Button variant="outline" className="mt-6" onClick={resetFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              {hotels.length} {hotels.length === 1 ? "property" : "properties"}
            </p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {hotels.map((hotel) => (
                <PropertyCard key={hotel._id} hotel={hotel} />
              ))}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
