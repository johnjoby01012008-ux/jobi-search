import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";
import { useState } from "react";

/**
 * Property photography with a graceful fallback. Remote images can fail (rate
 * limits, offline previews), so a broken URL degrades to a framed placeholder
 * rather than an empty box.
 */
export function HotelImage({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-accent via-secondary to-background",
          className,
        )}
      >
        <MapPin className="size-6 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
