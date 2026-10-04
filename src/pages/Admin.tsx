import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatMoney } from "@/convex/jobi/pricing";
import { useQuery } from "convex/react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link } from "react-router";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-editorial text-2xl">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function Admin() {
  const isAdmin = useQuery(api.admin.isAdmin);
  const stats = useQuery(api.admin.stats);
  const searches = useQuery(api.admin.listSearches);

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
          <h1 className="mt-4 font-editorial text-xl">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area shows platform-wide search metrics and requires an admin role.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to my searches</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <p className="eyebrow">Platform metrics</p>
      <h1 className="mt-3 font-editorial text-3xl sm:text-4xl">Admin dashboard</h1>

      {stats ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total searches" value={String(stats.totalSearches)} />
          <Stat label="Paid searches" value={String(stats.paidSearches)} />
          <Stat label="Completed" value={String(stats.completedSearches)} />
          <Stat
            label="Failed / partial"
            value={`${stats.failedSearches} / ${stats.partialSearches}`}
          />
          <Stat label="Revenue" value={formatMoney(stats.revenue, stats.currency)} sub="₹10 per paid search" />
          <Stat
            label="Avg search duration"
            value={`${(stats.avgDurationMs / 1000).toFixed(1)}s`}
          />
          <Stat label="Avg sources read" value={String(stats.avgSources)} />
          <Stat label="Avg verified offers" value={String(stats.avgVerifiedOffers)} />
        </div>
      ) : (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading metrics…
        </div>
      )}

      <section className="mt-10">
        <h2 className="eyebrow">Recent searches</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Destination</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Cheapest verified</th>
                <th className="px-4 py-3 font-medium">Sources</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(searches ?? []).map((row) => (
                <tr key={row._id}>
                  <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                    {row.user}
                  </td>
                  <td className="px-4 py-3">{row.destination}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(row.amountPaid, row.currency)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-normal capitalize">
                      {row.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(row.cheapestVerified)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {row.sourcesChecked}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(row.createdAt).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(searches ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No searches yet.</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
