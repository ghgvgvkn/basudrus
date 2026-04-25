/**
 * Bas Udrus wordmark.
 *
 * Serif-italic "Bas Udrus" with the "STUDY PARTNERS" tracked-caps
 * subtitle. No dot glyph, no underline — those belonged to the
 * legacy mark and tested as noise. The serif carries the identity.
 *
 * Sizes: `size` is the height of the primary wordmark in px. The
 * subtitle is absolutely proportioned (≈22% of size) and hidden in
 * `compact` mode. The whole mark is rendered as real text, NOT as
 * inline SVG, so it inherits color/weight from the parent and
 * respects the user's font-smoothing settings.
 */
import type { ReactNode } from "react";

interface LogoProps {
  /** Height of the primary wordmark in px. Default 28 (sidebar size). */
  size?: number;
  /** Hide the "STUDY PARTNERS" subtitle. */
  compact?: boolean;
  /** Optional click handler — e.g. nav-home from the sidebar header. */
  onClick?: () => void;
  /** Accessible label. Defaults to "Bas Udrus, home". */
  label?: string;
  /** Override color. Defaults to `currentColor` so it inherits. */
  color?: string;
  className?: string;
}

export function Logo({
  size = 28,
  compact = false,
  onClick,
  label = "Bas Udrus, home",
  color,
  className = "",
}: LogoProps): ReactNode {
  const subtitleSize = Math.max(9, Math.round(size * 0.22));
  const subtitleGap = Math.round(size * 0.12);
  const style: React.CSSProperties = color ? { color } : {};

  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={label}
      className={`inline-flex flex-col items-start gap-0 select-none ${
        onClick ? "cursor-pointer bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm" : ""
      } ${className}`}
      style={style}
    >
      <span
        className="serif block"
        style={{
          fontSize: size,
          lineHeight: 1,
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          letterSpacing: '-0.02em',
        }}
      >
        Bas Udrus
      </span>
      {!compact && (
        <span
          className="block"
          style={{
            fontSize: subtitleSize,
            lineHeight: 1,
            marginTop: subtitleGap,
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            opacity: 0.58,
          }}
        >
          Study Partners
        </span>
      )}
    </Tag>
  );
}

/**
 * Secondary Arabic mark — "بس ادرس". Used only on the favicon, app
 * icon, splash, and the landing hero. NEVER in chrome (sidebar,
 * top bar, tabs). The Latin wordmark is the primary identity; the
 * Arabic mark is the wink.
 */
export function LogoArabic({
  size = 28,
  color,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}): ReactNode {
  return (
    <span
      aria-label="Bas Udrus"
      className={`serif inline-block ${className}`}
      dir="rtl"
      lang="ar"
      style={{
        fontSize: size,
        lineHeight: 1,
        fontFamily: 'var(--font-display)',
        fontStyle: 'italic',
        fontWeight: 400,
        color: color,
      }}
    >
      بس ادرس
    </span>
  );
}
