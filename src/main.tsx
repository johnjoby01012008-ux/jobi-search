import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting.
//
// A dynamically imported module can fail to *fetch* transiently when the Vite
// dev server is re-optimizing dependencies or briefly invalidating its module
// graph (the browser surfaces it as "Failed to fetch dynamically imported
// module"). That is not a broken file, so reload the page once to refetch the
// module instead of crashing the preview. A genuinely broken module still
// throws on the second attempt.
const CHUNK_RELOAD_KEY = "jobi:chunk-reload-attempted";
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory()
      .then((module) => {
        // Loaded fine — allow a future transient failure to retry again.
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return module;
      })
      .catch((error) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
          window.location.reload();
        }
        throw error;
      }),
  );
}

const Landing = lazyWithRetry(() => import("./pages/Landing.tsx"));
const AuthPage = lazyWithRetry(() => import("./pages/Auth.tsx"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard.tsx"));
const SearchPage = lazyWithRetry(() => import("./pages/Search.tsx"));
const SearchDetail = lazyWithRetry(() => import("./pages/SearchDetail.tsx"));
const Hotels = lazyWithRetry(() => import("./pages/Hotels.tsx"));
const HotelDetail = lazyWithRetry(() => import("./pages/HotelDetail.tsx"));
const Checkout = lazyWithRetry(() => import("./pages/Checkout.tsx"));
const BookingDetail = lazyWithRetry(() => import("./pages/BookingDetail.tsx"));
const Admin = lazyWithRetry(() => import("./pages/Admin.tsx"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route path="/hotels" element={<Hotels />} />
              <Route path="/hotels/:slug" element={<HotelDetail />} />
              <Route
                path="/checkout"
                element={
                  <RequireAuth title="Sign in to reserve this stay">
                    <Checkout />
                  </RequireAuth>
                }
              />
              <Route
                path="/bookings/:id"
                element={
                  <RequireAuth title="Sign in to view this reservation">
                    <BookingDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/search"
                element={
                  <RequireAuth title="Sign in to research your stay">
                    <SearchPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/searches/:id"
                element={
                  <RequireAuth title="Sign in to view this search">
                    <SearchDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/dashboard/searches"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAuth title="Sign in to view admin metrics">
                    <Admin />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
