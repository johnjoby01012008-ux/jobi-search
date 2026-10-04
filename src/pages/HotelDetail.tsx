import { AppShell } from "@/components/AppShell";
import { HotelImage } from "@/components/HotelImage";
import { PropertyCard } from "@/components/PropertyCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";
import { nightsBetween } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useEnsureCatalog } from "@/hooks/use-catalog";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Loader2,
  MapPin,
  Star,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

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

export default function HotelDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  useEnsureCatalog();

  const hotel = useQuery(api.hotels.get, { slug: slug ?? "" });
  const related = useQuery(api.hotels.related, {
    slug: slug ?? "",
    destination: hotel?.destination ?? "",
  });

  const [galleryIndex, setGalleryIndex] = useState(0);
  const [roomName, setRoomName] = useState("");
  const [checkIn, setCheckIn] = useState(() => toISODate(addDays(new Date(), 1)));
  const [checkOut, setCheckOut] = useState(() => toISODate(addDays(new Date(), 4)));
  const [guests, setGuests] = useState(2);
  const [rooms, setRooms] = useState(1);

  if (hotel === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading property…
        </div>
      </AppShell>
    );
  }

  if (hotel === null) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="font-editorial text-xl">Property not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This property may have been removed from the collection.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/hotels">Back to properties</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const gallery = hotel.gallery.length > 0 ? hotel.gallery : [hotel.imageUrl];
  const activeImage = gallery[Math.min(galleryIndex, gallery.length - 1)];
  const selectedRoom = hotel.rooms.find((room) => room.name === roomName) ?? hotel.rooms[0];
  const nights = nightsBetween(checkIn, checkOut);
  const datesValid = nights >= 1;
  const maxGuests = selectedRoom?.maxGuests ?? 4;
  const nightsTotal = selectedRoom ? selectedRoom.nightlyRate * Math.max(nights, 1) * rooms : 0;

  const continueToCheckout = () => {
    if (!selectedRoom || !datesValid) return;
    const params = new URLSearchParams({
      hotel: hotel.slug,
      room: selectedRoom.name,
      checkIn,
      checkOut,
      guests: String(guests),
      rooms: String(rooms),
    });
    navigate(`/checkout?${params.toString()}`);
  };

  return (
    <AppShell>
      <Link
        to="/hotels"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> All properties
      </Link>

      {/* Gallery */}
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <HotelImage src={activeImage} className="aspect-[16/10] w-full" />
        </div>
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1 lg:grid-rows-3">
          {gallery.slice(0, 3).map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setGalleryIndex(index)}
              aria-label={`View image ${index + 1}`}
              className={cn(
                "overflow-hidden rounded-xl border bg-card transition-colors",
                index === galleryIndex ? "border-foreground/40" : "border-border hover:border-foreground/25",
              )}
            >
              <HotelImage src={image} className="aspect-[16/10] w-full lg:aspect-auto lg:h-full" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1.55fr_1fr]">
        {/* Property information */}
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{hotel.propertyType}</p>
              <h1 className="mt-2 font-editorial text-3xl sm:text-4xl">{hotel.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Star className="size-3.5 fill-current" /> {hotel.rating.toFixed(1)} ·{" "}
                  {hotel.reviews.toLocaleString("en-IN")} reviews
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {hotel.locality}, {hotel.destination}
                </span>
              </div>
            </div>
          </div>

          <Separator className="my-8" />

          <h2 className="font-editorial text-xl">About this property</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{hotel.description}</p>

          {hotel.highlights.length > 0 ? (
            <ul className="mt-6 space-y-3">
              {hotel.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-3 text-sm leading-6">
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-foreground/50" />
                  <span className="text-muted-foreground">{highlight}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <Separator className="my-8" />

          <h2 className="font-editorial text-xl">Amenities</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {hotel.amenities.map((amenity) => (
              <span key={amenity} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-3.5 text-foreground/60" />
                {amenity}
              </span>
            ))}
          </div>

          <Separator className="my-8" />

          <h2 className="font-editorial text-xl">Room types</h2>
          <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
            {hotel.rooms.map((room) => (
              <button
                key={room.name}
                type="button"
                onClick={() => setRoomName(room.name)}
                className={cn(
                  "flex w-full items-start justify-between gap-6 py-4 text-left transition-colors",
                  selectedRoom?.name === room.name ? "opacity-100" : "opacity-80 hover:opacity-100",
                )}
              >
                <span className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 size-3.5 shrink-0 rounded-full border",
                      selectedRoom?.name === room.name
                        ? "border-foreground bg-foreground"
                        : "border-border",
                    )}
                  />
                  <span>
                    <span className="block text-sm font-medium">{room.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {[room.mealPlan, room.cancellationPolicy].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium tabular-nums">
                    {formatMoney(room.nightlyRate, hotel.currency)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">per night</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Reservation panel */}
        <div id="reserve" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-6 shadow-frame">
            <div className="flex items-end justify-between">
              <div>
                <p className="eyebrow">From</p>
                <p className="mt-1 font-editorial text-2xl">
                  {formatMoney(selectedRoom?.nightlyRate ?? hotel.priceFrom, hotel.currency)}
                  <span className="ml-1 text-xs tracking-normal text-muted-foreground">/ night</span>
                </p>
              </div>
              <div className="text-right">
                <p className="eyebrow">Stay total</p>
                <p className="mt-1 font-editorial text-2xl tabular-nums">
                  {formatMoney(nightsTotal, hotel.currency)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="check-in">Check-in</Label>
                <Input
                  id="check-in"
                  type="date"
                  value={checkIn}
                  min={toISODate(new Date())}
                  onChange={(event) => setCheckIn(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="check-out">Check-out</Label>
                <Input
                  id="check-out"
                  type="date"
                  value={checkOut}
                  min={checkIn}
                  onChange={(event) => setCheckOut(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guests">Guests</Label>
                <Input
                  id="guests"
                  type="number"
                  min={1}
                  max={maxGuests}
                  value={guests}
                  onChange={(event) =>
                    setGuests(Math.min(maxGuests, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rooms">Rooms</Label>
                <Input
                  id="rooms"
                  type="number"
                  min={1}
                  max={5}
                  value={rooms}
                  onChange={(event) =>
                    setRooms(Math.min(5, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </div>
            </div>

            <div className="mt-5 space-y-2 border-t border-border/70 pt-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {formatMoney(selectedRoom?.nightlyRate ?? 0, hotel.currency)} × {Math.max(nights, 1)}{" "}
                  {nights === 1 ? "night" : "nights"} × {rooms} {rooms === 1 ? "room" : "rooms"}
                </span>
                <span className="tabular-nums">{formatMoney(nightsTotal, hotel.currency)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Taxes and fees</span>
                <span>Paid at the property</span>
              </div>
            </div>

            {!datesValid ? (
              <p className="mt-4 text-xs text-amber-700">
                Check-out must be at least one night after check-in.
              </p>
            ) : null}

            <Button
              className="mt-6 w-full gap-2"
              size="lg"
              disabled={!datesValid || !selectedRoom}
              onClick={continueToCheckout}
            >
              Continue to checkout
              <ArrowRight className="size-4" />
            </Button>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" /> {Math.max(nights, 1)}{" "}
                {nights === 1 ? "night" : "nights"}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" /> {guests} {guests === 1 ? "guest" : "guests"}
              </span>
            </div>

            <p className="mt-5 border-t border-border/70 pt-5 text-xs leading-5 text-muted-foreground">
              Jobi Search does not charge for your stay. We record the reservation and take you to
              the property&apos;s booking page to complete payment.
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
            <p className="eyebrow">Address</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{hotel.address}</p>
          </div>
        </div>
      </div>

      {related && related.length > 0 ? (
        <section className="mt-16 border-t border-border pt-10">
          <p className="eyebrow">Also in {hotel.destination}</p>
          <h2 className="mt-3 font-editorial text-2xl">Other properties nearby</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((entry) => (
              <PropertyCard key={entry._id} hotel={entry} />
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
