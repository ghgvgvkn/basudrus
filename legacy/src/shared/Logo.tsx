import type { Theme } from "@/lib/constants";

interface LogoProps {
  T: Theme;
  size?: number;
  compact?: boolean;
  onClick?: () => void;
}

export function Logo({ T, size = 21, compact = false, onClick }: LogoProps) {
  const scale = size / 21;
  const w = Math.round(160 * scale);
  const h = compact ? Math.round(32 * scale) : Math.round(64 * scale);
  const vb = compact ? "60 30 280 70" : "0 0 400 160";
  return (
    <span style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }} onClick={onClick}>
      <svg width={w} height={h} viewBox={vb}>
        <text x="200" y="88" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="500" fontSize="52" fill={T.navy} letterSpacing="-1">Bas Udrus</text>
        <circle cx="318" cy="50" r="5" fill="#4F7EF7" />
        <line x1="130" y1="105" x2="270" y2="105" stroke="#4F7EF7" strokeWidth="2" />
        {!compact && <text x="200" y="124" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="11" fill="#888888" letterSpacing="4">STUDY SMARTER</text>}
      </svg>
    </span>
  );
}
