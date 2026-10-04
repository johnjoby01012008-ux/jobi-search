import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LogOut, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

export function JobiMark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex items-baseline gap-1.5", className)}>
      <span className="font-editorial text-xl tracking-tight text-foreground">Jobi</span>
      <span className="eyebrow translate-y-[-2px]">AI</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = useQuery(api.admin.isAdmin);

  const navItems = [
    { href: "/dashboard", label: "My searches", icon: Search },
    { href: "/search", label: "New search", icon: Plus },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <JobiMark />
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            {isAdmin ? (
              <Link
                to="/admin"
                className={cn(
                  "hidden rounded-md px-3 py-1.5 text-sm transition-colors sm:block",
                  location.pathname === "/admin"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Admin
              </Link>
            ) : null}
            <div className="ml-2 hidden items-center gap-2 border-l border-border pl-3 sm:flex">
              <span className="max-w-[140px] truncate text-xs text-muted-foreground">
                {user?.email ?? user?.name ?? "Guest"}
              </span>
              <button
                type="button"
                aria-label="Sign out"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
