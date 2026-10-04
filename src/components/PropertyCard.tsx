import { HotelImage } from "@/components/HotelImage";
import { formatMoney } from "@/convex/jobi/pricing";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { ArrowRight, Star } from "lucide-react";
import { Link } from "react-router";

export function PropertyCard({
  hotel,
  className,
}: {
  hotel: Doc<"hotels">;
  className?: string;
}) {
  return (
    <Link
      to={`/hotels/${hotel.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/25",
        className,
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        <HotelImage
          src={hotel.imageUrl}
          className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
        {hotel.featured ? (
          <span className="absolute left-3 top-3 rounded-full bg-background/92 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
            Featured
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-editorial text-lg leading-snug">{hotel.name}</h3>
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-sm text-muted-foreground">
            <Star className="size-3.5 fill-current" />
            {hotel.rating.toFixed(1)}
          </span>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          {hotel.locality} · {hotel.destination}
        </p>

        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {hotel.description}
        </p>

        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
          <div>
            <p className="eyebrow">From</p>
            <p className="mt-1 font-editorial text-xl">
              {formatMoney(hotel.priceFrom, hotel.currency)}
              <span className="ml-1 text-xs tracking-normal text-muted-foreground">/ night</span>
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
            View
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
