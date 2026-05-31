/**
 * ScreenHeader — large iOS-style title that sits inside the scroll
 * view (not in the navigation chrome). Mirrors the SwiftUI large-title
 * navigation bar look without us having to fight Expo Router's stack
 * config.
 *
 * The optional `eyebrow` text appears small + muted above the title —
 * good for "Hello, Ahmed" framing.
 *
 * `serif` (NEW v2) renders the title in italic serif — the website uses
 * italic serif for marquee titles like "Discover" and "Hello, Ahmed.",
 * and the user called the existing system-sans treatment "cheap". Off
 * by default so older screens are untouched.
 */
import { StyleSheet, Text, View } from 'react-native';
import { font, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Render the title in italic serif (matches the website's marquee titles). */
  serif?: boolean;
};

export function ScreenHeader({ title, eyebrow, subtitle, serif }: Props) {
  const { c } = useTheme();
  return (
    <View style={styles.wrap}>
      {eyebrow ? (
        <Text style={[styles.eyebrow, { color: c.textMuted }]}>{eyebrow}</Text>
      ) : null}
      <Text
        style={[
          styles.title,
          serif && styles.titleSerif,
          { color: c.text },
        ]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
  },
  eyebrow: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  title: {
    fontSize: font.sizes.display,
    fontWeight: font.weights.bold,
    letterSpacing: -0.5,
  },
  titleSerif: {
    fontStyle: 'italic',
    // RN's only cross-platform serif. iOS resolves this to New York /
    // Times New Roman, Android to Noto Serif — both read as the
    // editorial serif the website uses for marquee titles.
    fontFamily: 'Georgia',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: font.sizes.md,
    marginTop: space.sm,
    lineHeight: 22,
  },
});
