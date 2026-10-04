import { AppShell } from "@/components/AppShell";
import { HotelImage } from "@/components/HotelImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateRange, nightsBetween } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const bookingId = id as Id<"bookings">;
  const booking = useQuery(api.bookings.get, { bookingId });
  const cancelBooking = useMutation(api.bookings.cancel);
  const [cancelling, setCancelling] = useState(false);

  if (booking === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading reservation…
        </div>
      </AppShell>
    );
  }

  if (booking === null) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="font-editorial text-xl">Reservation not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This reservation does not exist, or it belongs to another account.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const cancellable = booking.status === "reserved" || booking.status === "confirmed";

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelBooking({ bookingId });
      toast.success("Reservation cancelled.");
    } catch {
      toast.error("We could not cancel this reservation. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AppShell>
      <button
        type="button"
        onClick={() => navigate("/dashboard")}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Dashboard
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={booking.status === "cancelled" ? "destructive" : "secondary"}
          className="font-normal"
        >
          {STATUS_LABEL[booking.status] ?? booking.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Reference <span className="font-medium text-foreground">{booking.reference}</span>
        </span>
      </div>

      <h1 className="mt-4 font-editorial text-3xl sm:text-4xl">
        {booking.status === "cancelled" ? "Reservation cancelled" : "Your reservation is held"}
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        {booking.status === "cancelled"
          ? "We have released this hold. You can reserve another property at any time."
          : "We have recorded your reservation and passed the details to the property. Complete payment on the provider's booking page to confirm your stay."}
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-frame">
          <HotelImage src={booking.imageUrl} className="aspect-[16/9] w-full" />
          <div className="p-6">
            <h2 className="font-editorial text-2xl">{booking.hotelName}</h2>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-3.5" /> {booking.locality}, {booking.destination}
            </p>

            <Separator className="my-6" />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="eyebrow">Dates</p>
                <p className="mt-1.5 text-sm">
                  {formatDateRange(booking.checkIn, booking.checkOut)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {nights} {nights === 1 ? "night" : "nights"}
                </p>
              </div>
              <div>
                <p className="eyebrow">Room</p>
                <p className="mt-1.5 text-sm">{booking.roomName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {booking.guests} {booking.guests === 1 ? "guest" : "guests"} · {booking.rooms}{" "}
                  {booking.rooms === 1 ? "room" : "rooms"}
                </p>
              </div>
              <div>
                <p className="eyebrow">Lead guest</p>
                <p className="mt-1.5 text-sm">{booking.contactName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{booking.contactEmail}</p>
                {booking.contactPhone ? (
                  <p className="text-xs text-muted-foreground">{booking.contactPhone}</p>
                ) : null}
              </div>
              <div>
                <p className="eyebrow">Total</p>
                <p className="mt-1.5 font-editorial text-xl tabular-nums">
                  {formatMoney(booking.totalPrice, booking.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMoney(booking.nightlyRate, booking.currency)} per night
                </p>
              </div>
            </div>

            {booking.specialRequests ? (
              <>
                <Separator className="my-6" />
                <p className="eyebrow">Special requests</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {booking.specialRequests}
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-6 shadow-frame">
            {booking.status === "cancelled" ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <p className="text-sm leading-6 text-muted-foreground">
                  This reservation is closed. Nothing further is required from you.
                </p>
              </div>
            ) : (
              <>
                <h2 className="font-editorial text-xl">Complete your booking</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Continue to the provider&apos;s website to pay for your stay. Your dates, room and
                  guest details are ready for you there.
                </p>
                <Button asChild size="lg" className="mt-5 w-full gap-2">
                  <a href={booking.bookingUrl} target="_blank" rel="noopener noreferrer">
                    Pay {formatMoney(booking.totalPrice, booking.currency)} on {booking.providerName}
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Jobi Search never charges for your stay.
                </p>
              </>
            )}

            <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-background/60 p-4 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p>
                Rates and availability can change. Confirm the final total on the provider&apos;s
                page before paying. If the rate has moved, cancel here at no cost.
              </p>
            </div>

            {cancellable ? (
              <Button
                variant="outline"
                className="mt-4 w-full"
                disabled={cancelling}
                onClick={handleCancel}
              >
                {cancelling ? <Loader2 className="size-4 animate-spin" /> : "Cancel reservation"}
              </Button>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
            <p className="eyebrow">Property address</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {booking.hotelName}, {booking.locality}, {booking.destination}
            </p>
            <Link
              to={`/hotels/${booking.hotelSlug}`}
              className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              View property details
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
