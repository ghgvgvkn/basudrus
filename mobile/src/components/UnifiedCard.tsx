/**
 * UnifiedCard — single card design for every Discover feed entry.
 *
 * Mirrors the web app's UnifiedCard (web: /src/features/discover/
 * DiscoverScreen.tsx → UnifiedCard) so the brand reads as one
 * experience across devices.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ ┌────┐  Name (italic-ish, large)         │
 *   │ │ Av │  University                       │
 *   │ │ at │  Major · Year                     │
 *   │ └────┘                                    │
 *   ├──────────────────────────────────────────┤
 *   │ [ Asking: <subject> · 12m · online ]     │  (only if helpRequest)
 *   │                                           │
 *   │ Body text — help-request detail or bio.   │
 *   │                                           │
 *   │ [chip] [chip] [chip] [chip]   (subjects)  │
 *   │                                           │
 *   │ [ X ] [   Help them / Say hi  →    ]      │
 *   └──────────────────────────────────────────┘
 *
 * Help-asks bubble to the top of the feed (the hook orders them
 * first); within the card the only visible difference is the orange
 * "Asking: …" badge plus a "Help them" CTA instead of "Say hi".
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import type { FeedItem } from '@/hooks/useDiscoverFeed';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { useMatchScores } from '@/hooks/useMatchScores';

type Props = {
  item: FeedItem;
  onConnect: () => void;
  onSkip?: () => void;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function UnifiedCard({ item, onConnect, onSkip }: Props) {
  const { c, mode } = useTheme();
  const p = item.profile;
  const ask = item.helpRequest;

  // Per-candidate match — pure JS after the hook's warm-up fetch, so
  // it's cheap to call inside a list row. `match` is null when the
  // viewer hasn't taken the quiz yet OR when this row is the viewer
  // themselves; both cases naturally hide the badge.
  const { scoreFor } = useMatchScores();
  const match = scoreFor(p);

  const displayName = useMemo(
    () => (p.name || '').trim() || 'A student',
    [p.name],
  );

  // Recent / online detection — same 6-minute window the website uses.
  const isRecent = useMemo(() => {
    if (!p.last_seen_at) return false;
    const t = Date.parse(p.last_seen_at);
    return Number.isFinite(t) && Date.now() - t < 6 * 60 * 1000;
  }, [p.last_seen_at]);

  // Body prefers the help-request detail when this is an ask — bio is
  // secondary context in that case. Fallback chain: detail → bio →
  // friendly placeholder.
  const bodyText =
    (ask?.detail ?? '').trim() ||
    (p.bio ?? '').trim() ||
    `${displayName} is on Bas Udrus.`;

  const meta = [p.major, p.year ? `Year ${p.year}` : null]
    .filter(Boolean)
    .join(' · ');

  // CTA differs ONLY by label — same destination.
  const ctaLabel = ask ? 'Help them' : 'Say Hi';
  const ctaIcon: React.ComponentProps<typeof Ionicons>['name'] = ask
    ? 'hand-left'
    : 'chatbubble-ellipses';

  // Help-ask badge tint — warm accent so it's distinguishable from
  // the profile's own accent palette.
  const askTint = mode === 'dark' ? '#ffb558' : '#d97000';
  const askBg = mode === 'dark' ? 'rgba(255,181,88,0.16)' : 'rgba(217,112,0,0.10)';

  return (
    <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
      <View style={styles.header}>
        <Avatar
          emoji={p.avatar_emoji}
          color={p.avatar_color}
          photoUrl={p.photo_url}
          name={p.name}
          size={64}
          online={p.online === true || isRecent}
        />
        <View style={styles.headerText}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          {p.uni ? (
            <Text style={[styles.uni, { color: c.text }]} numberOfLines={1}>
              {p.uni}
            </Text>
          ) : null}
          {meta ? (
            <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {/* Match badge — mirrors the website's top-right serif
            italic %. Only renders when we actually have a score
            (viewer took the quiz AND row isn't the viewer). */}
        {match ? (
          <View style={styles.matchBadge}>
            <Text style={[styles.matchPct, { color: c.accent }]}>{match.score}%</Text>
            <Text style={[styles.matchLabel, { color: c.textFaint }]}>MATCH</Text>
          </View>
        ) : null}
      </View>

      {ask ? (
        <View style={[styles.askBadge, { backgroundColor: askBg }]}>
          <Ionicons name="help-buoy" size={13} color={askTint} />
          <Text style={[styles.askText, { color: askTint }]} numberOfLines={1}>
            Asking: {ask.subject}
          </Text>
          <Text style={[styles.askMeta, { color: c.textMuted }]}>
            · {timeAgo(ask.created_at)}
            {ask.meet_type ? ` · ${ask.meet_type.replace('_', ' ')}` : ''}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.body, { color: c.text }]} numberOfLines={4}>
        {bodyText}
      </Text>

      {Array.isArray(p.subjects) && p.subjects.length > 0 ? (
        <View style={styles.chipsRow}>
          {p.subjects.slice(0, 4).map(s => (
            <View
              key={s}
              style={[styles.subjectChip, { backgroundColor: c.bgElevated, borderColor: c.border }]}
            >
              <Text style={[styles.subjectChipText, { color: c.textMuted }]}>{s}</Text>
            </View>
          ))}
          {p.subjects.length > 4 ? (
            <View style={[styles.subjectChip, { backgroundColor: c.bgElevated, borderColor: c.border }]}>
              <Text style={[styles.subjectChipText, { color: c.textMuted }]}>
                +{p.subjects.length - 4}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {match && match.reasons.length > 0 ? (
        <View style={[styles.reasonsBox, { borderTopColor: c.border }]}>
          {match.reasons.slice(0, 3).map(r => (
            <Text key={r} style={[styles.reasonText, { color: c.textMuted }]}>
              · {r}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        {onSkip ? (
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip"
            style={({ pressed }) => [
              styles.skipBtn,
              {
                backgroundColor: c.bgElevated,
                borderColor: c.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="close" size={20} color={c.textMuted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onConnect}
          style={({ pressed }) => [
            styles.connectBtn,
            {
              backgroundColor: ask
                ? askTint
                : mode === 'dark'
                  ? c.accent
                  : '#111111',
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name={ctaIcon}
            size={16}
            color={ask ? '#fff' : mode === 'dark' ? '#000' : '#fff'}
          />
          <Text
            style={[
              styles.connectText,
              { color: ask ? '#fff' : mode === 'dark' ? '#000' : '#fff' },
            ]}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
    letterSpacing: -0.3,
  },
  uni: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.medium,
  },
  meta: {
    fontSize: font.sizes.sm,
  },

  matchBadge: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: space.sm,
  },
  matchPct: {
    fontSize: 26,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  matchLabel: {
    fontSize: 9,
    fontWeight: font.weights.bold,
    letterSpacing: 1.2,
    marginTop: 2,
  },

  reasonsBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    gap: 4,
  },
  reasonText: {
    fontSize: font.sizes.sm,
    lineHeight: 18,
  },

  askBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  askText: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.bold,
    flexShrink: 1,
  },
  askMeta: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.medium,
  },

  body: {
    fontSize: font.sizes.md,
    lineHeight: 22,
  },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectChip: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  subjectChipText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.medium,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
  skipBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  connectText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    letterSpacing: 0.2,
  },
});
