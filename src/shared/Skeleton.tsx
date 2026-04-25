/**
 * Skeleton — small reusable loading placeholder.
 *
 * Tailwind animate-pulse + surface-3 token. Use directly with
 * width/height utility classes, e.g.:
 *   <Skeleton className="h-5 w-1/2 rounded" />
 *
 * Why a component instead of an inline div? Consistency: every loader
 * across the app uses the same color + animation, and we can swap the
 * implementation (shimmer, fade, etc.) in one place.
 */
import type { CSSProperties } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`block bg-surface-3 animate-pulse ${className}`}
      style={style}
    />
  );
}

/** Convenience — a row with avatar circle + two text lines. Used on
 *  thread lists, notification rows, room cards. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
      <Skeleton className="h-11 w-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5 rounded" />
        <Skeleton className="h-3 w-3/5 rounded" />
      </div>
    </div>
  );
}
