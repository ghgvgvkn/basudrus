import type { Profile } from "./types";

interface AvatarProps {
  profile?: Pick<Profile, "name" | "avatar_color" | "photo_mode" | "photo_url"> | null;
  size?: number;
  className?: string;
  /** Pass profile.last_seen_at (ISO string) to render a presence dot.
   *  Online = active within ONLINE_WINDOW_MS (default 6 min — matches
   *  the 5-min heartbeat with a 1-min grace window for late writes).
   *  Set to null/undefined to hide the dot entirely. */
  lastSeenAt?: string | null | undefined;
  /** Override the default online window in milliseconds. */
  onlineWindowMs?: number;
}

const DEFAULT_ONLINE_WINDOW_MS = 6 * 60 * 1000; // 6 minutes

/** Returns true if the given timestamp is within the online window
 *  relative to "now". Pure function — same input always gives same
 *  result for a frozen `now`, useful for tests. */
export function isOnline(lastSeenAt: string | null | undefined, windowMs = DEFAULT_ONLINE_WINDOW_MS, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  return (now - t) <= windowMs;
}

/**
 * Shared avatar. Shows the profile photo when `photo_mode === "photo"`
 * and a photo_url exists; otherwise draws initials on a coloured
 * disc (`avatar_color`). Matches the sidebar user-card rendering.
 *
 * Optionally renders a presence dot (small green circle, ringed in
 * surface-1 so it stays visible on any background) when `lastSeenAt`
 * is within the online window. The dot is positioned at the bottom-
 * right of the avatar circle, sized proportionally so it stays
 * visible at any avatar size.
 */
export function Avatar({
  profile,
  size = 40,
  className = "",
  lastSeenAt,
  onlineWindowMs,
}: AvatarProps) {
  const name = profile?.name?.trim() || "?";
  const color = profile?.avatar_color || "#5B4BF5";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

  // Presence dot — sized as a fraction of the avatar so it scales
  // cleanly from 28px chip avatars to 96px profile cards.
  const showDot = isOnline(lastSeenAt, onlineWindowMs);
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const ringSize = Math.max(2, Math.round(size * 0.05));

  const isPhoto = profile?.photo_mode === "photo" && profile.photo_url;

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {isPhoto ? (
        <img
          src={profile.photo_url!}
          alt=""
          width={size}
          height={size}
          className="rounded-full object-cover w-full h-full"
        />
      ) : (
        <div
          className="rounded-full grid place-items-center text-white font-semibold w-full h-full"
          style={{ background: color, fontSize: size * 0.4 }}
          aria-hidden
        >
          {initials}
        </div>
      )}
      {showDot && (
        <span
          aria-label="online"
          className="absolute rounded-full"
          style={{
            width: dotSize,
            height: dotSize,
            right: 0,
            bottom: 0,
            background: "#22C55E",
            boxShadow: `0 0 0 ${ringSize}px var(--color-surface-1)`,
          }}
        />
      )}
    </div>
  );
}
