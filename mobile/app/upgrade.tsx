/**
 * Upgrade — Pro pitch screen.
 *
 * Now a 1:1 port of the website's `src/features/subscription/
 * SubscriptionScreen.tsx` (the ShowUpgrade variant). Per the user
 * brief ("Can you update the upgrading in the app with the same one
 * in the website with this photos I gave you?") the previous
 * crown-emoji + Free/Pro/Squad gradient design is gone — this screen
 * now mirrors the web's editorial Free + Pro comparison.
 *
 * Visual structure (top → bottom):
 *   1. Pill badge — solid ink background with a Sparkles glyph and
 *      "Bas Udrus Pro" label.
 *   2. Hero headline — italic serif (Georgia) "Study without the
 *      ceiling." Approximates the web's `font-serif italic` since
 *      mobile ships no custom font.
 *   3. Subtitle — muted explainer line.
 *   4. Plan cards — stacked vertically (the web is a 2-col grid on
 *      md+; on mobile we always stack):
 *        • Free card — surface-card bg, "FREE" eyebrow + "Current"
 *          pill on the right (when tier is free).
 *        • Pro card — INVERTED (ink bg, light text), "PRO" eyebrow +
 *          "COMING SOON" pill, Infinity / Zap / Check bullets, a
 *          disabled "Coming soon" CTA with a clock glyph.
 *   5. Footer — Pro coming-soon disclaimer copy, character-for-
 *      character match to the web.
 *
 * Why no real IAP yet: mobile billing isn't wired (no StoreKit / Play
 * Billing integration). The web's `PAYMENTS_LIVE` gate is set to
 * false, so the website is also showing the "Coming soon" disabled
 * state — we just mirror that here. When we wire StoreKit, flip
 * `PAYMENTS_LIVE` below and the CTA reactivates.
 *
 * Tier detection: query `profiles.pro` for the current user so a Pro
 * user who lands here sees their existing "Current" pill on the Pro
 * card instead of on Free. Doesn't load synchronously; treats null
 * as "free" until the query resolves so the initial paint isn't
 * blank.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

/** Mirror of the web's `PAYMENTS_LIVE`. When false (current state)
 *  the Pro CTA renders disabled with a clock icon and "Coming soon"
 *  label so the card still looks finished but nobody can flip to Pro
 *  for free. Flip to true once IAP is wired. */
const PAYMENTS_LIVE = false;

/** AI message cap on the free tier. Hardcoded to mirror the web's
 *  `subscription.aiCap = 10` for free users. */
const FREE_AI_CAP = 10;

type Feature = string | { icon: React.ReactNode; text: string };

export default function UpgradeScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const [isPro, setIsPro] = useState(false);

  // Detect Pro from the profile row so the "Current" pill lands on
  // the right card. Best-effort: silent on error, default to free.
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('pro')
          .eq('id', session.user.id)
          .maybeSingle();
        if (!cancelled) setIsPro((data as { pro?: boolean } | null)?.pro === true);
      } catch {
        /* leave as free */
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Upgrade',
          headerBackTitle: 'Back',
          headerTintColor: c.text,
          headerStyle: { backgroundColor: c.bg },
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={[styles.proPill, { backgroundColor: c.text }]}>
            <Ionicons name="sparkles" size={12} color={c.bg} />
            <Text style={[styles.proPillText, { color: c.bg }]}>Bas Udrus Pro</Text>
          </View>
          <Text style={[styles.heroTitle, { color: c.text }]}>
            Study without{'\n'}the ceiling.
          </Text>
          <Text style={[styles.heroSub, { color: c.textMuted }]}>
            Unlimited AI, priority matching, and the features we add
            this year.
          </Text>
        </View>

        {/* ── Plan cards ───────────────────────────────────────────── */}
        <View style={styles.plansWrap}>
          <Plan
            name="Free"
            price="JD 0"
            cadence="forever"
            current={!isPro}
            features={[
              `${FREE_AI_CAP} AI messages / day`,
              'Join up to 3 study rooms',
              'Standard Discover matching',
              '1-on-1 chat',
            ]}
          />
          <Plan
            name="Pro"
            price="JD 3.99"
            cadence="/ month"
            featured
            current={isPro}
            comingSoon={!PAYMENTS_LIVE}
            features={[
              {
                icon: <Ionicons name="infinite" size={14} color={c.bg} />,
                text: 'Unlimited AI (Tony Starrk + Sherlock)',
              },
              {
                icon: <Ionicons name="flash" size={14} color={c.bg} />,
                text: 'Priority Discover placement',
              },
              'Upload PDFs, docs, images to AI',
              'Voice messages in chat',
              'Unlimited study rooms',
              'Early access to new features',
            ]}
            ctaLabel={PAYMENTS_LIVE ? 'Upgrade — JD 3.99 / mo' : 'Coming soon'}
            ctaDisabled={!PAYMENTS_LIVE}
            ctaIcon={!PAYMENTS_LIVE ? 'time-outline' : undefined}
            onCta={() => {
              if (!PAYMENTS_LIVE) return;
              tap();
              // Real IAP would be wired here.
            }}
          />
        </View>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <Text style={[styles.footer, { color: c.textMuted }]}>
          {PAYMENTS_LIVE
            ? 'Billed monthly. Cancel anytime. Student pricing for .edu.jo emails.'
            : "Pro is coming soon \u2014 payments are still being set up. Free tier is fully active and will stay free for every student. We\u2019ll announce when Pro is live."}
        </Text>

        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.maybeLater, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Text style={[styles.maybeLaterText, { color: c.textMuted }]}>
            Maybe later
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Plan card — mirrors the web's `Plan` function. `featured` flips
 * the card to inverted (ink bg, light text), matching the web's
 * `bg-ink text-bg border-ink` treatment for the Pro tile.
 * ───────────────────────────────────────────────────────────────── */
function Plan({
  name,
  price,
  cadence,
  features,
  featured,
  current,
  comingSoon,
  ctaLabel,
  ctaDisabled,
  ctaIcon,
  onCta,
}: {
  name: string;
  price: string;
  cadence: string;
  features: Feature[];
  featured?: boolean;
  current?: boolean;
  comingSoon?: boolean;
  ctaLabel?: string;
  ctaDisabled?: boolean;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  onCta?: () => void;
}) {
  const { c } = useTheme();

  // Featured = inverted card (ink background, surface text). The web
  // uses `bg-ink text-bg`; on mobile that's c.text → bg color and
  // c.bg → text color. Works for both light and dark mode because
  // c.text is always the high-contrast ink and c.bg the surface.
  const bg = featured ? c.text : c.bgCard;
  const fg = featured ? c.bg : c.text;
  // 70% / 60% opacity variants of the foreground for muted text.
  const fgMuted = featured ? withAlpha(c.bg, 0.7) : withAlpha(c.text, 0.6);
  // Border tint — subtle line on free, near-invisible on the inverted
  // pro card (it already has full contrast from its bg).
  const borderColor = featured ? c.text : c.border;
  // Bullet bubble bg — soft tint of the foreground.
  const bulletBg = featured ? withAlpha(c.bg, 0.15) : withAlpha(c.text, 0.06);

  return (
    <View style={[styles.planCard, { backgroundColor: bg, borderColor }]}>
      {/* Eyebrow + status pill row */}
      <View style={styles.planTopRow}>
        <Text style={[styles.planEyebrow, { color: fgMuted }]}>
          {name.toUpperCase()}
        </Text>
        {current && !featured ? (
          <View style={[styles.statusPill, { backgroundColor: withAlpha(c.text, 0.08) }]}>
            <Text style={[styles.statusPillText, { color: c.text }]}>Current</Text>
          </View>
        ) : null}
        {current && featured ? (
          <View style={[styles.statusPill, { backgroundColor: withAlpha(c.bg, 0.18) }]}>
            <Text style={[styles.statusPillText, { color: c.bg }]}>Current</Text>
          </View>
        ) : null}
        {comingSoon && !current ? (
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: featured
                  ? withAlpha(c.bg, 0.15)
                  : withAlpha(c.text, 0.08),
              },
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                styles.statusPillTextUppercase,
                { color: featured ? c.bg : fgMuted },
              ]}
            >
              Coming soon
            </Text>
          </View>
        ) : null}
      </View>

      {/* Price row — serif italic to match the web */}
      <View style={styles.priceRow}>
        <Text style={[styles.price, { color: fg }]}>{price}</Text>
        <Text style={[styles.cadence, { color: fgMuted }]}> {cadence}</Text>
      </View>

      {/* Feature bullets */}
      <View style={styles.featureList}>
        {features.map((f, i) => {
          const isObj = typeof f !== 'string';
          const text = isObj ? f.text : f;
          const icon = isObj ? f.icon : (
            <Ionicons name="checkmark" size={14} color={fg} />
          );
          return (
            <View key={i} style={styles.featureRow}>
              <View style={[styles.bulletBubble, { backgroundColor: bulletBg }]}>
                {icon}
              </View>
              <Text style={[styles.featureText, { color: fg }]}>{text}</Text>
            </View>
          );
        })}
      </View>

      {/* CTA — only Pro card sets one. */}
      {ctaLabel ? (
        <Pressable
          onPress={ctaDisabled ? undefined : onCta}
          disabled={ctaDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!ctaDisabled }}
          style={({ pressed }) => [
            styles.ctaBtn,
            {
              backgroundColor: ctaDisabled
                ? withAlpha(c.bg, 0.3)
                : c.bg,
              opacity: pressed && !ctaDisabled ? 0.85 : 1,
            },
          ]}
        >
          {ctaIcon ? (
            <Ionicons
              name={ctaIcon}
              size={14}
              color={ctaDisabled ? withAlpha(c.bg, 0.85) : c.text}
              style={{ marginRight: 6 }}
            />
          ) : null}
          <Text
            style={[
              styles.ctaBtnText,
              { color: ctaDisabled ? withAlpha(c.bg, 0.85) : c.text },
            ]}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Color helpers
 * ───────────────────────────────────────────────────────────────── */

/** Apply an opacity to a hex or rgb(a) color. Used so we can derive
 *  60%/15% variants of the theme's text/bg without exposing every
 *  opacity tier as its own theme token. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3
      ? hex.split('').map(ch => ch + ch).join('')
      : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Already rgba(...) — sloppy but acceptable replace.
  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(',').map(s => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  /* ─ Hero ───────────────────────────────────────────────────────── */
  hero: {
    alignItems: 'center',
    paddingTop: space.lg,
    paddingBottom: space.xl,
    gap: space.md,
  },
  proPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 28,
    borderRadius: radius.pill,
  },
  proPillText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.medium,
    letterSpacing: 0.2,
  },
  heroTitle: {
    fontSize: 42,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    fontWeight: font.weights.regular,
    letterSpacing: -1,
    textAlign: 'center',
    lineHeight: 44,
    marginTop: space.sm,
  },
  heroSub: {
    fontSize: font.sizes.md,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
    marginTop: space.xs,
  },

  /* ─ Plan card layout ───────────────────────────────────────────── */
  plansWrap: {
    marginTop: space.xl,
    gap: space.md,
  },
  planCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: space.xl,
  },
  planTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planEyebrow: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
    letterSpacing: 1.4,
  },

  statusPill: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: font.weights.medium,
    letterSpacing: 0.2,
  },
  statusPillTextUppercase: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  /* ─ Price row ─────────────────────────────────────────────────── */
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: space.md,
  },
  price: {
    fontSize: 42,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    fontWeight: font.weights.regular,
    letterSpacing: -0.8,
  },
  cadence: {
    fontSize: font.sizes.sm,
  },

  /* ─ Feature list ─────────────────────────────────────────────── */
  featureList: {
    marginTop: space.lg,
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  bulletBubble: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureText: {
    fontSize: font.sizes.sm,
    flex: 1,
    lineHeight: 20,
  },

  /* ─ CTA button ───────────────────────────────────────────────── */
  ctaBtn: {
    marginTop: space.xl,
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.medium,
    letterSpacing: 0.1,
  },

  /* ─ Footer copy + maybe-later ───────────────────────────────── */
  footer: {
    marginTop: space.xl,
    fontSize: font.sizes.xs,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: space.lg,
    opacity: 0.85,
  },
  maybeLater: {
    alignItems: 'center',
    paddingVertical: space.lg,
    marginTop: space.sm,
  },
  maybeLaterText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.medium,
  },
});
