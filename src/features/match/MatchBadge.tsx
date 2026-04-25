/**
 * MatchBadge — small visual chip showing a match %.
 *
 * Used by ConnectScreen thread list, RoomsScreen member previews,
 * ProfileDrawer headers, and anywhere else we want a compact,
 * consistent "this person is X% compatible with you" indicator.
 *
 * Visual:
 *   - Pill shape, accent-colored fill on high scores, neutral on low
 *   - Tiny "match" caption inside for clarity
 *
 * Hidden if score is null (viewer isn't authed or it's the viewer
 * themselves) — caller doesn't need to gate on that.
 */
import type { CSSProperties } from "react";

export function MatchBadge({
  score,
  size = "sm",
  className = "",
}: {
  score: number | null | undefined;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  if (typeof score !== "number") return null;

  // Color tier — accent for strong matches, neutral for weak. Keeps
  // the feed from looking like a sea of identical badges.
  const tier =
    score >= 80 ? "strong" :
    score >= 60 ? "ok" :
    "weak";

  const tierStyle: Record<string, CSSProperties> = {
    strong: { background: "var(--color-accent-soft)", color: "var(--color-accent-ink)" },
    ok:     { background: "var(--color-surface-2)",   color: "var(--color-ink-1)" },
    weak:   { background: "var(--color-surface-2)",   color: "var(--color-ink-3)" },
  };

  const sizeClass =
    size === "xs" ? "h-5 px-1.5 text-[10px]" :
    size === "md" ? "h-7 px-2.5 text-xs" :
                    "h-6 px-2 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold tabular-nums ${sizeClass} ${className}`}
      style={tierStyle[tier]}
      aria-label={`${score} percent match`}
      title={`${score}% match — based on personality + study profile`}
    >
      {score}%
      <span className="opacity-60 font-medium">match</span>
    </span>
  );
}
