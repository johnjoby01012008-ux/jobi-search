import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect } from "react";

/** Module-level guard so the seed call runs once per browser session, not per mount. */
let seededThisSession = false;

/**
 * Ensures the curated property catalog exists. The mutation is idempotent, so
 * this is safe to call from any page that browses inventory.
 */
export function useEnsureCatalog() {
  const ensureCatalog = useMutation(api.hotels.ensureCatalog);

  useEffect(() => {
    if (seededThisSession) return;
    // Defer out of the effect body so the call is not a synchronous side effect.
    const timer = window.setTimeout(() => {
      ensureCatalog({})
        .then(() => {
          seededThisSession = true;
        })
        .catch(() => {
          seededThisSession = false;
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ensureCatalog]);
}
