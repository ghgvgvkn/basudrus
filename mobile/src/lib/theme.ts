/**
 * Theme tokens — colors, spacing, typography, radii.
 *
 * Two palettes: dark (default, matches Aurora/basudrus dark aesthetic)
 * and light. Pulled from `useColorScheme()` at the screen level so iOS
 * dark-mode toggle in Control Center updates instantly with no app
 * restart.
 *
 * Why hand-rolled tokens instead of a UI library (NativeBase, Tamagui,
 * GlueStack):
 *   - 0 extra deps. Mobile bundle stays small.
 *   - Total control over the JARVIS-adjacent dark aesthetic.
 *   - No fight with a library's opinion when we add audio-reactive
 *     glows or HUD-style chrome later.
 */
export type ColorMode = 'light' | 'dark';

// Pulled from `src/index.css` on the website (the :root and .dark
// overrides). Mirroring those tokens here is the cleanest way to keep
// the mobile and web look identical — when a screen uses `c.accent`,
// it gets the same purple that `bg-accent` paints on the web.
//
// Token map (website CSS var → mobile field):
//   --color-surface-1 → bgElevated, bgCard
//   --color-surface-0 → bg                    (page background)
//   --color-ink-1     → text
//   --color-ink-3     → textMuted
//   --color-line      → border
//   --color-line-2    → borderStrong
//   --color-accent    → accent
//   --color-accent-soft → accentSoft

const dark = {
  bg: '#0F0D18',          // --color-surface-0
  bgElevated: '#15131E',  // --color-surface-1
  bgCard: '#15131E',      // --color-surface-1 (cards = elevated surface)
  border: '#2A2640',      // --color-line
  borderStrong: '#3C3756',// --color-line-2
  text: '#F4F1E8',        // --color-ink-1
  textMuted: '#8E87A3',   // --color-ink-3
  textFaint: 'rgba(244,241,232,0.38)',
  accent: '#9688FF',      // --color-accent (dark)
  accentSoft: '#1F1A3D',  // --color-accent-soft (dark)
  danger: '#ff5d5d',
  success: '#39d27a',
} as const;

const light = {
  bg: '#FAF7EE',          // --color-surface-0
  bgElevated: '#FFFFFF',  // --color-surface-1
  bgCard: '#FFFFFF',      // --color-surface-1
  border: '#E7E1D4',      // --color-line
  borderStrong: '#D6CEB9',// --color-line-2
  text: '#1A1F2C',        // --color-ink-1
  textMuted: '#5A6070',   // --color-ink-3
  textFaint: 'rgba(26,31,44,0.38)',
  accent: '#5B4BF5',      // --color-accent (light)
  accentSoft: '#EDEBFF',  // --color-accent-soft (light)
  danger: '#ff3b30',
  success: '#34c759',
} as const;

export const colors = { dark, light } as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const font = {
  // iOS system font — gets San Francisco free. On Android falls back
  // to Roboto. No custom font files to ship in v1.
  family: undefined as string | undefined,
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 22,
    xxl: 28,
    display: 34,
  },
} as const;

export function palette(mode: ColorMode) {
  return mode === 'dark' ? dark : light;
}
