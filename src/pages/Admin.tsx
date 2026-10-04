import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { formatDateRange } from "@/convex/jobi/parse";
import { formatMoney } from "@/convex/jobi/pricing";
import { useEnsureCatalog } from "@/hooks/use-catalog";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-editorial text-2xl">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

interface PropertyFormState {
  name: string;
  slug: string;
  destination: string;
  locality: string;
  address: string;
  propertyType: string;
  rating: string;
  nightlyRate: string;
  imageUrl: string;
  description: string;
  featured: boolean;
}

function emptyForm(): PropertyFormState {
  return {
    name: "",
    slug: "",
    destination: "",
    locality: "",
    address: "",
    propertyType: "Hotel",
    rating: "4.5",
    nightlyRate: "9000",
    imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=70",
    description: "",
    featured: false,
  };
}

function formFromHotel(hotel: Doc<"hotels">): PropertyFormState {
  return {
    name: hotel.name,
    slug: hotel.slug,
    destination: hotel.destination,
    locality: hotel.locality,
    address: hotel.address,
    propertyType: hotel.propertyType,
    rating: String(hotel.rating),
    nightlyRate: String(hotel.rooms[0]?.nightlyRate ?? hotel.priceFrom),
    imageUrl: hotel.imageUrl,
    description: hotel.description,
    featured: hotel.featured,
  };
}

function PropertyDialog({
  open,
  onOpenChange,
  hotel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotel: Doc<"hotels"> | null;
}) {
  const createHotel = useMutation(api.hotels.create);
  const updateHotel = useMutation(api.hotels.update);
  const [form, setForm] = useState<PropertyFormState>(() =>
    hotel ? formFromHotel(hotel) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!form.name.trim() || !form.destination.trim() || !form.locality.trim()) {
      toast.error("Name, destination and locality are required.");
      return;
    }
    setSaving(true);
    try {
      const nightlyRate = Math.max(0, Number(form.nightlyRate) || 0);
      const rating = Math.min(5, Math.max(1, Number(form.rating) || 4));

      if (hotel) {
        const rooms =
          hotel.rooms[0] && hotel.rooms[0].nightlyRate !== nightlyRate
            ? [{ ...hotel.rooms[0], nightlyRate }, ...hotel.rooms.slice(1)]
            : undefined;
        await updateHotel({
          hotelId: hotel._id,
          name: form.name.trim(),
          destination: form.destination.trim(),
          locality: form.locality.trim(),
          propertyType: form.propertyType.trim(),
          rating,
          imageUrl: form.imageUrl.trim(),
          description: form.description.trim(),
          featured: form.featured,
          ...(rooms ? { rooms } : {}),
        });
        toast.success("Property updated.");
      } else {
        const slug =
          form.slug.trim().toLowerCase() ||
          form.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        await createHotel({
          slug,
          name: form.name.trim(),
          destination: form.destination.trim(),
          locality: form.locality.trim(),
          address:
            form.address.trim() ||
            `${form.locality.trim()}, ${form.destination.trim()}`,
          propertyType: form.propertyType.trim() || "Hotel",
          rating,
          reviews: 0,
          imageUrl: form.imageUrl.trim(),
          description: form.description.trim(),
          amenities: [],
          highlights: [],
          rooms: [{ name: "Standard Room", nightlyRate, mealPlan: "Breakfast included", maxGuests: 2 }],
          tags: [],
          featured: form.featured,
        });
        toast.success("Property added to the catalog.");
      }
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the property.";
      toast.error(message.split("\n").filter(Boolean).pop() ?? "Could not save the property.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-editorial">
            {hotel ? "Edit property" : "Add property"}
          </DialogTitle>
          <DialogDescription>
            {hotel
              ? "Changes appear in the catalog immediately."
              : "New properties are published to the catalog straight away."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prop-name">Property name</Label>
            <Input
              id="prop-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          {!hotel ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prop-slug">URL slug (optional)</Label>
              <Input
                id="prop-slug"
                value={form.slug}
                onChange={(event) => set("slug", event.target.value)}
                placeholder="derived from the name if left blank"
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="prop-destination">Destination</Label>
            <Input
              id="prop-destination"
              value={form.destination}
              onChange={(event) => set("destination", event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-locality">Locality</Label>
            <Input
              id="prop-locality"
              value={form.locality}
              onChange={(event) => set("locality", event.target.value)}
            />
          </div>
          {!hotel ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prop-address">Address</Label>
              <Input
                id="prop-address"
                value={form.address}
                onChange={(event) => set("address", event.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="prop-type">Property type</Label>
            <Input
              id="prop-type"
              value={form.propertyType}
              onChange={(event) => set("propertyType", event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prop-rating">Rating</Label>
              <Input
                id="prop-rating"
                type="number"
                step="0.1"
                min="1"
                max="5"
                value={form.rating}
                onChange={(event) => set("rating", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prop-rate">From (₹ / night)</Label>
              <Input
                id="prop-rate"
                type="number"
                min="0"
                value={form.nightlyRate}
                onChange={(event) => set("nightlyRate", event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prop-image">Image URL</Label>
            <Input
              id="prop-image"
              value={form.imageUrl}
              onChange={(event) => set("imageUrl", event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prop-description">Description</Label>
            <Textarea
              id="prop-description"
              rows={4}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(event) => set("featured", event.target.checked)}
              className="size-4 rounded border-border"
            />
            Feature this property on the home page
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {hotel ? "Save changes" : "Add property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Admin() {
  useEnsureCatalog();
  const isAdmin = useQuery(api.admin.isAdmin);
  const stats = useQuery(api.admin.stats);
  const searches = useQuery(api.admin.listSearches);
  const bookings = useQuery(api.bookings.listAll);
  const properties = useQuery(api.hotels.list, { sort: "name", limit: 200 });
  const removeProperty = useMutation(api.hotels.remove);
  const setBookingStatus = useMutation(api.bookings.setStatus);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"hotels"> | null>(null);

  if (isAdmin === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Checking permissions…
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <ShieldAlert className="mx-auto size-6 text-muted-foreground" />
          <h1 className="mt-4 font-editorial text-xl">Administrators only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area manages inventory, reservations and platform metrics.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to my trips</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (hotel: Doc<"hotels">) => {
    setEditing(hotel);
    setDialogOpen(true);
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">Manage Jobi Search</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Inventory, reservations, research quality and revenue in one place.
          </p>
        </div>
        <Button className="gap-2 self-start" onClick={openCreate}>
          <Plus className="size-4" /> Add property
        </Button>
      </div>

      <Tabs defaultValue="overview" className="mt-10">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reservations">
            Reservations{bookings && bookings.length > 0 ? ` (${bookings.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="searches">Price searches</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-6">
          {stats ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Properties" value={String(stats.totalProperties)} />
              <Stat label="Reservations" value={String(stats.totalBookings)} />
              <Stat
                label="Active holds"
                value={String(stats.activeBookings)}
                sub={`${stats.cancelledBookings} cancelled`}
              />
              <Stat
                label="Reserved value"
                value={formatMoney(stats.bookedValue, stats.currency)}
                sub="Paid at the property"
              />
              <Stat label="Price searches" value={String(stats.totalSearches)} />
              <Stat label="Paid searches" value={String(stats.paidSearches)} />
              <Stat
                label="Research revenue"
                value={formatMoney(stats.revenue, stats.currency)}
                sub="₹10 per paid search"
              />
              <Stat
                label="Avg search duration"
                value={`${(stats.avgDurationMs / 1000).toFixed(1)}s`}
                sub={`${stats.avgVerifiedOffers} verified offers on average`}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading metrics…
            </div>
          )}
        </TabsContent>

        {/* Reservations */}
        <TabsContent value="reservations" className="mt-6">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Dates</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(bookings ?? []).map((booking) => (
                  <tr key={booking._id}>
                    <td className="px-4 py-3 font-medium">{booking.reference}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                      {booking.guestEmail}
                    </td>
                    <td className="px-4 py-3">{booking.hotelName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateRange(booking.checkIn, booking.checkOut)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(booking.totalPrice, booking.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={booking.status}
                        onValueChange={(value) =>
                          void setBookingStatus({
                            bookingId: booking._id,
                            status: value as "reserved" | "confirmed" | "cancelled" | "completed",
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="reserved">Reserved</SelectItem>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(bookings ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No reservations yet.
              </p>
            ) : null}
          </div>
        </TabsContent>

        {/* Properties */}
        <TabsContent value="properties" className="mt-6">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Destination</th>
                  <th className="px-4 py-3 font-medium">From</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Featured</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(properties ?? []).map((property) => (
                  <tr key={property._id}>
                    <td className="px-4 py-3">
                      <Link
                        to={`/hotels/${property.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {property.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{property.destination}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(property.priceFrom, property.currency)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{property.rating.toFixed(1)}</td>
                    <td className="px-4 py-3">
                      {property.featured ? (
                        <Badge variant="secondary" className="font-normal">
                          Featured
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${property.name}`}
                          onClick={() => openEdit(property)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${property.name}`}
                          onClick={async () => {
                            try {
                              await removeProperty({ hotelId: property._id });
                              toast.success("Property removed.");
                            } catch {
                              toast.error("Could not remove this property.");
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(properties ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No properties in the catalog.
              </p>
            ) : null}
          </div>
        </TabsContent>

        {/* Price searches */}
        <TabsContent value="searches" className="mt-6">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Destination</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Cheapest verified</th>
                  <th className="px-4 py-3 font-medium">Sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(searches ?? []).map((row) => (
                  <tr key={row._id}>
                    <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                      {row.user}
                    </td>
                    <td className="px-4 py-3">{row.destination}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(row.amountPaid, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="font-normal capitalize">
                        {row.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatMoney(row.cheapestVerified)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {row.sourcesChecked}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(searches ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No price searches yet.
              </p>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      {dialogOpen ? (
        <PropertyDialog
          key={editing?._id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          hotel={editing}
        />
      ) : null}
    </AppShell>
  );
}
