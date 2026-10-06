import { JobiMark } from "@/components/AppShell";
import { PropertyCard } from "@/components/PropertyCard";
import { TripSearchBox, type SearchDetails } from "@/components/TripSearchBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useEnsureCatalog } from "@/hooks/use-catalog";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  ExternalLink,
  Globe,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

/* ------------------------------------------------------------------------- */
/* Small animation helpers                                                    */
/* ------------------------------------------------------------------------- */

const EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function CountUp({ to, prefix = "", suffix = "", duration = 1.1 }: { to: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [value, setValue] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    let frame = 0;
    const start = performance.now();
    const total = reduced ? 0 : duration * 1000;
    const tick = (now: number) => {
      const progress = total === 0 ? 1 : Math.min(1, (now - start) / total);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * to));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, to, duration, reduced]);

  return (
    <span ref={ref}>
      {prefix}
      {value.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

function StaggeredHeadline() {
  const words = ["The", "right", "stay,", "at", "a", "verified", "rate."];
  return (
    <h1 className="text-balance font-editorial text-4xl leading-[1.05] text-foreground sm:text-5xl md:text-6xl">
      {words.map((word, index) => (
        <motion.span
          key={index}
          className="mr-[0.28em] inline-block"
          initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.75, ease: EASE, delay: 0.1 + index * 0.075 }}
        >
          {word === "verified" ? (
            <span className="relative">
              {word}
              <motion.span
                aria-hidden
                className="absolute -bottom-1 left-0 h-[2px] bg-accent-foreground/40"
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 0.8, ease: EASE, delay: 1.1 }}
              />
            </span>
          ) : (
            word
          )}
        </motion.span>
      ))}
    </h1>
  );
}

const DEMO_OFFERS = [
  { provider: "Cleartrip", total: 9450, status: "verified" as const },
  { provider: "Booking.com", total: 9100, status: "verified" as const },
  { provider: "Agoda", total: 8740, status: "verified" as const },
  { provider: "Trivago", total: 8300, status: "observed" as const },
];

function ComparisonDemo() {
  const maxValue = Math.max(...DEMO_OFFERS.map((o) => o.total));
  const [phase, setPhase] = useState(0);
  const ordered = useMemo(
    () => [...DEMO_OFFERS].sort((a, b) => b.total - a.total),
    [],
  );

  useEffect(() => {
    const timer = setInterval(() => setPhase((p) => (p + 1) % 4), 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-frame sm:p-6">
      <div className="flex items-center justify-between border-b border-border/70 pb-4">
        <div>
          <p className="eyebrow">Live comparison · demo</p>
          <p className="mt-1 font-editorial text-lg">Taj-style beach resort · Goa</p>
        </div>
        <Badge variant="secondary" className="gap-1 font-normal">
          <CalendarDays className="size-3.5" /> Dec 12 – 15
        </Badge>
      </div>

      <div className="mt-5 space-y-3.5">
        {ordered.map((offer, index) => {
          const isCheapest = offer.status === "verified" && offer.total === 8740;
          const highlighted = phase === index;
          return (
            <div key={offer.provider} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  {offer.provider}
                  {offer.status === "verified" ? (
                    <BadgeCheck className="size-3.5 text-emerald-600/80" />
                  ) : (
                    <AlertTriangle className="size-3.5 text-amber-600/80" />
                  )}
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    isCheapest ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  ₹{offer.total.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    offer.status === "verified" ? "bg-foreground/70" : "bg-amber-500/40",
                  )}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(offer.total / maxValue) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.15 + index * 0.1 }}
                  animate={{ opacity: highlighted ? 1 : 0.85 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-lg border border-border/70 bg-background/60 p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {phase === 3 ? (
              <p className="text-sm text-muted-foreground">
                Another source displayed{" "}
                <span className="font-medium text-foreground">₹8,300</span>, but Jobi could not
                verify it for your exact dates.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Cheapest verified offer: ₹8,740.</span>{" "}
                The algorithm — not the AI — decides this.
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Tell us what you want",
    body: "Describe your trip in plain language — destination, dates, guests and what matters to you. Understanding it is free.",
    icon: Users,
  },
  {
    title: "See a sponsored ad",
    body: "A clearly labelled sponsored ad appears while Jobi researches and again between the results — that keeps the search free, with no subscription and no booking fee.",
    icon: BadgeCheck,
  },
  {
    title: "Jobi searches widely",
    body: "We query multiple permitted sources — hotel sites, OTAs and booking platforms — then normalise every offer.",
    icon: Globe,
  },
  {
    title: "We compare real totals",
    body: "Room, taxes and mandatory fees are compared on the final total, and only what Jobi can verify is called cheapest.",
    icon: Search,
  },
  {
    title: "Reserve, then pay at the property",
    body: "Jobi holds the reservation and passes your details to the property. Payment is completed on the provider's own page.",
    icon: ExternalLink,
  },
];

const PROVIDERS = [
  "Booking.com",
  "Agoda",
  "MakeMyTrip",
  "Goibibo",
  "Cleartrip",
  "Yatra",
  "Trivago",
  "Hotels.com",
  "IHG",
  "Marriott",
];

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  useEnsureCatalog();

  const featured = useQuery(api.hotels.list, {
    featuredOnly: true,
    sort: "rating",
    limit: 3,
  });

  const handleSearch = (query: string, details: SearchDetails) => {
    const params = new URLSearchParams({ q: query });
    if (details.checkIn) params.set("checkIn", details.checkIn);
    if (details.checkOut) params.set("checkOut", details.checkOut);
    if (details.guests) params.set("guests", String(details.guests));
    navigate(`/search?${params.toString()}`);
  };

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-background">
      {/* Ambient studio backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="paper-grid absolute inset-x-0 top-0 h-[560px] opacity-40" />
        <motion.div
          className="absolute -top-32 -left-24 size-[420px] rounded-full bg-accent blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -top-20 right-[-120px] size-[380px] rounded-full bg-secondary blur-3xl"
          animate={{ x: [0, -24, 0], y: [0, 26, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-x-0 top-0 h-[620px] bg-gradient-to-b from-transparent via-transparent to-background" />
      </div>

      {/* Nav */}
      <header className="relative z-20">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
          <JobiMark />
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/hotels"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              Properties
            </Link>
            <a
              href="#how"
              className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <a
              href="#trust"
              className="hidden rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Trust
            </a>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/dashboard")}>
                My trips
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => navigate("/auth")}
                >
                  Sign in
                </Button>
                <Button size="sm" onClick={() => navigate("/auth?returnTo=%2Fhotels")}>
                  Book a stay
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1"
            >
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span className="eyebrow">Smart booking through AI</span>
            </motion.div>

            <div className="mt-6">
              <StaggeredHeadline />
            </div>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.7 }}
              className="mt-5 max-w-xl text-pretty text-[1.05rem] leading-7 text-muted-foreground"
            >
              Tell Jobi Search what you want. Our engine reads your request, compares published
              rates across permitted booking sources, and reserves the property with the provider.
              There is no booking markup, ever.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.85 }}
              className="mt-8 max-w-xl"
            >
              <TripSearchBox onSubmit={handleSearch} />
            </motion.div>

            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.2 }}
              className="mt-10 grid max-w-xl grid-cols-3 divide-x divide-border border-y border-border"
            >
              {[
                { label: "Research fee", value: "Free" },
                { label: "Rates verified", value: "Always" },
                { label: "Booking markup", value: "₹0" },
              ].map((stat) => (
                <div key={stat.label} className="px-2 py-4 text-center first:pl-0 last:pr-0">
                  <dt className="eyebrow">{stat.label}</dt>
                  <dd className="mt-1 font-editorial text-2xl">{stat.value}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 28, rotate: -1.2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.4 }}
            className="lg:pt-6"
          >
            <ComparisonDemo />
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Prices shown are demo data. Jobi only labels a price “verified” when it can support it.
            </div>
          </motion.div>
        </div>

        {/* Provider marquee */}
        <div className="relative mt-16 overflow-hidden border-y border-border py-4">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />
          <div className="flex w-max animate-marquee items-center gap-10">
            {[...PROVIDERS, ...PROVIDERS].map((provider, index) => (
              <span
                key={`${provider}-${index}`}
                className="whitespace-nowrap font-editorial text-lg text-muted-foreground/70"
              >
                {provider}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Featured properties */}
      {featured && featured.length > 0 ? (
        <section className="relative z-10 pb-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">The collection</p>
                  <h2 className="mt-3 max-w-xl font-editorial text-3xl sm:text-4xl">
                    Properties we would book ourselves.
                  </h2>
                </div>
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/hotels">
                    Browse all properties <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </Reveal>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((hotel) => (
                <Reveal key={hotel._id}>
                  <PropertyCard hotel={hotel} className="h-full" />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* How it works */}
      <section id="how" className="relative z-10 border-t border-border bg-card/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Reveal>
            <p className="eyebrow">The process</p>
            <h2 className="mt-3 max-w-2xl font-editorial text-3xl sm:text-4xl">
              A research assistant for hotel prices — not another booking site.
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 0.06} className="bg-card">
                <div className="flex h-full flex-col gap-4 p-6">
                  <div className="flex items-center justify-between">
                    <span className="font-editorial text-2xl text-muted-foreground/50">
                      0{index + 1}
                    </span>
                    <step.icon className="size-4 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-medium">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Advisor section */}
      <section className="relative z-10 py-20">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-8 lg:grid-cols-2">
          <Reveal>
            <p className="eyebrow">Jobi acts like an advisor</p>
            <h2 className="mt-3 font-editorial text-3xl sm:text-4xl">
              It asks the right questions before it shows you a sponsored ad and your results.
            </h2>
            <p className="mt-5 max-w-lg leading-7 text-muted-foreground">
              Vague requests get vague prices. Jobi reads your request, then shows exactly what it
              understood — the locality you care about, how close you want to be, your dates, party
              size and budget — so you can confirm or correct it before the search begins.
            </p>

            <div className="mt-8 space-y-3">
              {[
                { icon: MapPin, label: "Locality", value: "Baga Beach, Goa" },
                { icon: Search, label: "Proximity", value: "within 2 km" },
                { icon: CalendarDays, label: "Dates", value: "Dec 12 – Dec 15" },
                { icon: Users, label: "Guests", value: "2 guests · 1 room" },
                { icon: CreditCard, label: "Budget", value: "₹10,000 total" },
              ].map((row, index) => (
                <motion.div
                  key={row.label}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, ease: EASE, delay: index * 0.08 }}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                >
                  <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <row.icon className="size-4" />
                    {row.label}
                  </span>
                  <span className="text-sm font-medium">{row.value}</span>
                </motion.div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="rounded-xl border border-border bg-card p-6 shadow-frame sm:p-8">
              <p className="eyebrow">What you could save</p>
              <div className="mt-4 flex items-end gap-4">
                <span className="font-editorial text-5xl text-foreground">
                  <CountUp to={710} prefix="₹" />
                </span>
                <span className="pb-2 text-sm text-muted-foreground">
                  versus the average of the other verified offers
                </span>
              </div>
              <div className="mt-6 space-y-4 border-t border-border pt-6 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Average verified alternative</span>
                  <span className="tabular-nums">₹9,450</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cheapest verified</span>
                  <span className="font-medium tabular-nums">₹8,740</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Unverified comparison price</span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    ₹8,300 <AlertTriangle className="size-3.5 text-amber-600/80" />
                  </span>
                </div>
              </div>
              <p className="mt-6 text-xs leading-5 text-muted-foreground">
                Savings are only ever calculated against verified prices — never against something
                Jobi couldn&apos;t confirm for your dates.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="relative z-10 border-t border-border bg-card/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Reveal>
            <p className="eyebrow">Trust</p>
            <h2 className="mt-3 max-w-3xl font-editorial text-3xl sm:text-4xl">
              Jobi Search is a research and booking-assistance service. We never hold your payment.
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Globe,
                title: "We search available sources",
                body: "Jobi queries permitted sources and booking platforms, normalises every offer, and directs you to the provider to complete the booking.",
              },
              {
                icon: BadgeCheck,
                title: "Verified means verified",
                body: "A snippet price is only ever shown as observed. The cheapest result is calculated by deterministic logic from prices Jobi can actually support.",
              },
              {
                icon: AlertTriangle,
                title: "Prices can change",
                body: "Availability and rates move constantly. Jobi's result reflects what was available at the moment of the search — always confirm the total on the provider's page.",
              },
            ].map((item, index) => (
              <Reveal key={item.title} delay={index * 0.08}>
                <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-6">
                  <item.icon className="size-5 text-muted-foreground" />
                  <h3 className="text-base font-medium">{item.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <div className="mt-10 flex flex-col items-start gap-4 rounded-xl border border-border bg-background p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Jobi never claims “cheapest on the internet”. We say{" "}
                <span className="font-medium text-foreground">cheapest verified offer we found</span>{" "}
                — and we tell you which sources we checked and which we couldn&apos;t.
              </p>
              <Button onClick={() => navigate(isAuthenticated ? "/hotels" : "/auth?returnTo=%2Fhotels")}>
                Browse the collection
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <JobiMark />
          <p className="max-w-2xl leading-5">
            Jobi Search is a research and booking-assistance service. Stays are reserved with the
            property and paid on the provider&apos;s website. © {new Date().getFullYear()} Jobi
            Search.
          </p>
          <Link to="/auth" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
