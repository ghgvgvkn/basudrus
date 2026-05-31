/**
 * StudyMatchBanner — thin rectangular entry-point banner that drops the
 * user into the AI-to-AI Study Match flow (`/study-match`).
 *
 * Lives on:
 *   • Home (`app/(tabs)/index.tsx`) — sits near the top so the AI match
 *     flow is one tap away from the first thing the user sees. Uses the
 *     default 'accent' variant (soft purple icon tile) so it pops off
 *     the home feed.
 *   • Discover (`app/(tabs)/discover.tsx`) — sits above the candidate
 *     list so when the user is already scanning people, they can pivot
 *     to "let the AIs decide" in one tap. Uses the 'mono' variant per
 *     the user's brief: "you could keep the black colour instead of
 *     the blue one" — the icon tile renders solid near-black with a
 *     white sparkle so it visually matches the Discover filter button's
 *     active state (which is also solid black-on-white).
 *
 * Design intent — the user asked for "a small rectangle box, a very
 * thin one". So:
 *   • Single-row layout (icon · text stack · chevron), ~56pt tall.
 *   • Thin 1pt border in the theme line color so it reads as a
 *     navigation chip, not a marquee card.
 *   • Soft accent-tinted (or solid-black, depending on variant) icon
 *     tile on the left so the visual identity immediately telegraphs
 *     the AI nature without coloring the whole banner.
 *
 * Single source of truth for the entry-point copy and styling — if
 * we change "Try AI match" to "Match with AI" later, it changes
 * everywhere this banner is rendered.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

/** Tony's accent purple — kept literal (not from theme.accent) so the
 *  Sparkles glyph reads the same purple in light AND dark mode the way
 *  the website's `text-accent` does on the `:root` light token. */
const TONY_PURPLE = '#5B4BF5';
const TONY_PURPLE_SOFT = '#5B4BF514';

type Variant = 'accent' | 'mono';

type Props = {
  /** Optional override for the action title. */
  title?: string;
  /** Optional override for the subline. */
  subtitle?: string;
  /** Pulled inward by a parent margin when needed — most callers omit. */
  style?: { marginTop?: number; marginBottom?: number };
  /**
   * Visual treatment for the icon tile.
   *   - 'accent' (default): soft purple tile with a Tony-purple sparkle.
   *     Used on Home where the banner is the visual anchor and the
   *     accent color is part of the AI identity.
   *   - 'mono': solid near-black tile with a white sparkle (inverts in
   *     dark mode to white-on-ink so contrast holds). Used on Discover
   *     per the user's explicit ask: "keep the black colour instead of
   *     the blue one" — it visually matches the Discover filter
   *     button's active state.
   */
  variant?: Variant;
};

export function StudyMatchBanner({
  title = 'Try AI match',
  subtitle = 'Two Tonys decide if you\u2019d study well together',
  style,
  variant = 'accent',
}: Props) {
  const { c, mode } = useTheme();
  const router = useRouter();

  // Mono variant mirrors the Discover "Filters" button active state so
  // the AI-match entry reads as a primary action of the same visual
  // family. In light mode that's solid #111 with a white glyph; in
  // dark mode we flip to a light tile with the ink color so contrast
  // holds against the dark elevated card.
  const tileBg =
    variant === 'mono'
      ? mode === 'dark'
        ? c.text
        : '#111111'
      : TONY_PURPLE_SOFT;
  const iconColor =
    variant === 'mono'
      ? mode === 'dark'
        ? c.bg
        : '#FFFFFF'
      : TONY_PURPLE;

  return (
    <Pressable
      onPress={() => {
        tap();
        router.push('/study-match');
      }}
      accessibilityRole="button"
      accessibilityLabel="Try AI Study Match"
      style={({ pressed }) => [
        styles.banner,
        {
          backgroundColor: c.bgCard,
          borderColor: c.border,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
        <Ionicons name="sparkles" size={14} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  iconTile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontSize: 11.5,
    lineHeight: 14,
    marginTop: 1,
  },
});
