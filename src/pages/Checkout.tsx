import { AppShell } from "@/components/AppShell";
import { HotelImage } from "@/components/HotelImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { formatDateRange, isValidISODate, nightsBetween } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

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

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const createBooking = useMutation(api.bookings.create);

  const slug = searchParams.get("hotel") ?? "";
  const roomName = searchParams.get("room") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const guests = Number(searchParams.get("guests") ?? "2");
  const rooms = Number(searchParams.get("rooms") ?? "1");

  const hotel = useQuery(api.hotels.get, { slug });

  const [contactName, setContactName] = useState(user?.name ?? "");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nights = nightsBetween(checkIn, checkOut);
  const paramsValid =
    slug.length > 0 &&
    roomName.length > 0 &&
    isValidISODate(checkIn) &&
    isValidISODate(checkOut) &&
    nights >= 1 &&
    guests >= 1 &&
    rooms >= 1;

  if (!paramsValid) return <Navigate to="/hotels" replace />;

  if (hotel === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Preparing checkout…
        </div>
      </AppShell>
    );
  }

  if (hotel === null) return <Navigate to="/hotels" replace />;

  const room = hotel.rooms.find((option) => option.name === roomName) ?? hotel.rooms[0];
  const nightsTotal = room.nightlyRate * nights * rooms;
  const canSubmit =
    contactName.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());

  const confirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createBooking({
        hotelSlug: hotel.slug,
        roomName: room.name,
        checkIn,
        checkOut,
        guests,
        rooms,
        contactName,
        contactEmail,
        contactPhone: contactPhone || undefined,
        specialRequests: specialRequests || undefined,
      });
      navigate(`/bookings/${result.bookingId}`);
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <Link
        to={`/hotels/${hotel.slug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back to {hotel.name}
      </Link>

      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">Confirm your reservation</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Review the details below and tell us who is travelling. Jobi Search records the reservation
        and passes it to the property; payment for the stay is completed on the provider&apos;s own
        booking page.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* Guest details */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-frame">
          <h2 className="font-editorial text-xl">Guest details</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Lead guest name</Label>
              <Input
                id="contact-name"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Full name as it appears on ID"
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contact-phone">Phone (optional)</Label>
              <Input
                id="contact-phone"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="For the property to reach you"
                autoComplete="tel"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="special-requests">Special requests (optional)</Label>
              <Textarea
                id="special-requests"
                value={specialRequests}
                onChange={(event) => setSpecialRequests(event.target.value)}
                rows={3}
                placeholder="Late arrival, accessibility needs, dietary requirements"
              />
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-background/60 p-4 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>
              Your details are shared only with the property to hold the reservation. Requests are
              confirmed subject to availability; the property will contact you if anything changes.
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-frame">
            <HotelImage src={hotel.imageUrl} className="aspect-[16/9] w-full" />
            <div className="p-6">
              <h2 className="font-editorial text-xl">{hotel.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {hotel.locality} · {hotel.destination}
              </p>

              <div className="mt-5 space-y-2 border-t border-border/70 pt-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dates</span>
                  <span>{formatDateRange(checkIn, checkOut)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Room</span>
                  <span>{room.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guests</span>
                  <span>
                    {guests} {guests === 1 ? "guest" : "guests"} · {rooms}{" "}
                    {rooms === 1 ? "room" : "rooms"}
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-2 border-t border-border/70 pt-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {formatMoney(room.nightlyRate)} × {nights} {nights === 1 ? "night" : "nights"} ×{" "}
                    {rooms}
                  </span>
                  <span className="tabular-nums">{formatMoney(nightsTotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Taxes and property fees</span>
                  <span>Paid at the property</span>
                </div>
                <Separator className="my-3" />
                <div className="flex items-center justify-between">
                  <span className="font-medium">Stay total</span>
                  <span className="font-editorial text-xl tabular-nums">
                    {formatMoney(nightsTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Jobi Search fee</span>
                  <span>None — no booking markup</span>
                </div>
              </div>

              <Button
                className="mt-6 w-full gap-2"
                size="lg"
                disabled={!canSubmit || submitting}
                onClick={confirm}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Reserve now
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                You will complete payment on the provider&apos;s website.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
