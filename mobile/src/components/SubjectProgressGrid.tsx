/**
 * SubjectProgressGrid — visual per-subject progress card grid.
 *
 * React Native rewrite of `src/features/ai/SubjectProgressGrid.tsx` on
 * the website. Same hierarchy:
 *   • Big emoji + label (palette-tinted card)
 *   • Mastery bar (0-100%) — fills with the accent color
 *   • Sessions + topics counts
 *   • Footer: last studied (relative) · strong / review counts
 *
 * Layout: a wrapping flex row of cards that take roughly 48% width each
 * (≈2 columns on phone). Inline `flexBasis` instead of a media query —
 * RN doesn't ship one, but every phone we target is wide enough for
 * the 2-up layout to read well.
 *
 * States:
 *   • Loading → 3 skeleton cards
 *   • Empty   → friendly nudge to start a chat
 *   • Data    → cards sorted by last-studied
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { paletteFor } from '@/lib/subjectPalette';
import { useSubjectProgress, type SubjectProgressSummary } from '@/hooks/useSubjectProgress';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { tap } from '@/lib/haptics';

function formatRelative(iso: string | null): string {
  if (!iso) return 'Not yet';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Not yet';
  const ms = Date.now() - t;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.round(d / 7)} wk ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${Math.round(d / 365)} yr ago`;
}

function ProgressCard({ row }: { row: SubjectProgressSummary }) {
  const { c } = useTheme();
  const p = paletteFor(row.subject);
  const masteryPct = Math.round(row.masteryHint * 100);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: p.soft,
          borderColor: `${p.accent}33`,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View
            style={[
              styles.emojiTile,
              { backgroundColor: `${p.accent}1F` },
            ]}
          >
            <Text style={styles.emojiText}>{p.emoji}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[styles.cardLabel, { color: c.text }]}
              numberOfLines={1}
            >
              {p.label}
            </Text>
            <Text
              style={[styles.cardMeta, { color: c.textMuted }]}
              numberOfLines={1}
            >
              {row.sessionsCount}{' '}
              {row.sessionsCount === 1 ? 'session' : 'sessions'}
              {row.topicsCount > 0
                ? ` · ${row.topicsCount} ${row.topicsCount === 1 ? 'topic' : 'topics'}`
                : ''}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.masteryPct, { color: p.accent }]}
          accessibilityLabel={`Mastery ${masteryPct} percent`}
        >
          {masteryPct}%
        </Text>
      </View>

      {/* Mastery bar */}
      <View
        style={[
          styles.barTrack,
          { backgroundColor: `${p.accent}1A` },
        ]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: masteryPct }}
      >
        <View
          style={[
            styles.barFill,
            { width: `${masteryPct}%`, backgroundColor: p.accent },
          ]}
        />
      </View>

      {/* Footer: last studied + strong/weak counts */}
      <View style={styles.cardFooter}>
        <Text style={[styles.footerText, { color: c.textMuted }]}>
          Last: {formatRelative(row.lastSessionAt)}
        </Text>
        {(row.strongCount > 0 || row.weakCount > 0) && (
          <View style={styles.footerRight}>
            {row.strongCount > 0 ? (
              <Text style={[styles.footerText, { color: c.textMuted }]}>
                <Text style={{ color: p.accent, fontWeight: '700' }}>
                  {row.strongCount}
                </Text>{' '}
                strong
              </Text>
            ) : null}
            {row.weakCount > 0 ? (
              <Text style={[styles.footerText, { color: c.textMuted }]}>
                <Text style={{ color: '#e11d48', fontWeight: '700' }}>
                  {row.weakCount}
                </Text>{' '}
                review
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function EmptyState() {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => { tap(); router.push('/(tabs)/ai'); }}
      style={({ pressed }) => [
        styles.emptyCard,
        {
          borderColor: c.border,
          backgroundColor: c.bgCard,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Start a chat with Bas Udrus"
    >
      <Text style={styles.emptyEmoji}>📚</Text>
      <Text style={[styles.emptyTitle, { color: c.text }]}>No progress yet</Text>
      <Text style={[styles.emptyBody, { color: c.textMuted }]}>
        Start a chat with Bas Udrus and your first session will show up here.
        Every subject you study gets its own card.
      </Text>
    </Pressable>
  );
}

function SkeletonCard() {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.bgCard,
          borderColor: c.border,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.skeletonTile, { backgroundColor: c.border }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[styles.skeletonLine, { backgroundColor: c.border, width: '60%' }]} />
            <View style={[styles.skeletonLine, { backgroundColor: c.border, width: '40%', height: 10 }]} />
          </View>
        </View>
      </View>
      <View style={[styles.barTrack, { backgroundColor: c.border, marginTop: space.md }]} />
      <View style={[styles.skeletonLine, { backgroundColor: c.border, width: '50%', marginTop: space.md }]} />
    </View>
  );
}

interface Props {
  /** Section title — when omitted falls back to "Subject progress". */
  title?: string;
  /** Render the title inside this component (default true). Set false
   *  when the parent renders its own heading. */
  showTitle?: boolean;
}

export function SubjectProgressGrid({
  title = 'Subject progress',
  showTitle = true,
}: Props) {
  const { c } = useTheme();
  const { rows, loading } = useSubjectProgress();

  return (
    <View>
      {showTitle && (
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          {!loading && rows.length > 0 && (
            <Text style={[styles.count, { color: c.textMuted }]}>
              {rows.length} {rows.length === 1 ? 'subject' : 'subjects'}
            </Text>
          )}
        </View>
      )}

      {loading && (
        <View style={styles.grid}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      )}

      {!loading && rows.length === 0 && <EmptyState />}

      {!loading && rows.length > 0 && (
        <View style={styles.grid}>
          {rows.map((r) => (
            <ProgressCard key={String(r.subject)} row={r} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  title: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },
  count: {
    fontSize: font.sizes.sm,
    fontVariant: ['tabular-nums'],
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  card: {
    // 48% leaves a sliver of breathing room for the `gap`. RN's gap
    // between siblings + flexBasis 48% reliably lays out 2-per-row on
    // any phone we target.
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 0,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    minWidth: 0,
  },
  emojiTile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 20 },
  cardLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },
  cardMeta: {
    fontSize: 11.5,
    marginTop: 2,
  },
  masteryPct: {
    fontSize: 13,
    fontWeight: font.weights.bold,
    fontVariant: ['tabular-nums'],
  },

  barTrack: {
    marginTop: space.md,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },

  cardFooter: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  footerText: {
    fontSize: 11,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },

  // Empty state
  emptyCard: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 28, marginBottom: space.sm },
  emptyTitle: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: font.sizes.sm,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
  },

  // Skeleton
  skeletonTile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    opacity: 0.5,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 4,
    opacity: 0.5,
  },
});
