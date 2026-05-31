/**
 * Home v6 — focused, minimal feed.
 *
 * User feedback (v5 → v6, paraphrased):
 *   "Show one match first, put past papers right next to it, then
 *    rooms, then streak, then recent activity (as a teaser that
 *    invites scrolling), then upgrade. Delete everything extra. Make
 *    the past papers card match the new website design."
 *
 * What that translates to:
 *   1. NO greeting hero. NO Ask Tony hero. NO MagicMomentCard. NO
 *      Explore grid. NO FAB. (Magic-moment + Ask-Tony lived on v5;
 *      the AI tab is one tab away and the streak section still has
 *      a "Post for help" CTA so the FAB was redundant.)
 *   2. Section 1 is a 2-column row at the very top:
 *        Left  — ONE best-match card (avatar, name, major · year,
 *                 % match, Say hi).
 *        Right — ONE top past paper card (file icon, course, uni ·
 *                 year, Open). Styled to match
 *                 `src/features/past-papers/PastPapersScreen.tsx`
 *                 (`bu-card` row with icon circle in accent tint).
 *      Each mini-card has its own "All →" link in the header so the
 *      user can dive into the full Discover / Papers tabs.
 *   3. Rooms today — compact bento card (up to 3 rows).
 *   4. Streak + XP — compact bento card with the primary
 *      "Post for help" CTA.
 *   5. Recent activity — 3-item teaser + "See more →" link, so the
 *      page invites a scroll without dumping the whole feed.
 *   6. Upgrade to Pro — gradient banner, only when isPro is false.
 *
 * Typography matches the website's home:
 *   - Italic Georgia for serifH2 headers ("Rooms today",
 *     "Recent activity") and the streak number (40pt).
 *   - Compact UPPERCASE eyebrow labels (11pt, tracking) for the two
 *     mini-cards at the top — they're smaller than full H2s and
 *     visually balance side-by-side.
 *
 * The `useRecentActivity`, `useDiscoverFeed`, `useMatchScores`,
 * `useRooms`, `usePastPapers` hooks remain unchanged — v6 is a
 * pure presentation refactor on top of v5's data plumbing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { XPBar } from '@/components/XPBar';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { usePastPapers } from '@/hooks/usePastPapers';
import { useRooms } from '@/hooks/useRooms';
import { useDiscoverFeed } from '@/hooks/useDiscoverFeed';
import { useMatchScores } from '@/hooks/useMatchScores';
import { useGameTracking } from '@/hooks/useGameTracking';
import { useRecentActivity, type ActivityItem } from '@/hooks/useRecentActivity';
import { thump, tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { AskTonyHomeHero } from '@/components/AskTonyHomeHero';
import { StudyMatchBanner } from '@/components/StudyMatchBanner';

type ProfileLite = {
  name?: string | null;
  xp?: number | null;
  streak?: number | null;
  uni?: string | null;
  major?: string | null;
  pro?: boolean | null;
};

/** Same purple Tony's surfaces use across the web + AI tab. */
const TONY_PURPLE = '#5B4BF5';
const TONY_PURPLE_SOFT = '#5B4BF514';

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Date.now() - t;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function paperSubline(p: {
  uni: string;
  course_code: string | null;
  exam_type: string | null;
  semester: string | null;
  year: number | null;
}): string {
  const semLabel = p.semester ? p.semester[0].toUpperCase() + p.semester.slice(1) : null;
  const examLabel = p.exam_type ? p.exam_type[0].toUpperCase() + p.exam_type.slice(1) : null;
  return [
    p.uni,
    p.course_code,
    examLabel,
    semLabel && p.year ? `${semLabel} ${p.year}` : (semLabel || (p.year ? String(p.year) : null)),
  ].filter(Boolean).join(' · ');
}

export default function HomeScreen() {
  const { mode, c } = useTheme();
  const dark = mode === 'dark';
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Recent activity starts as a 3-item teaser so the page invites a
  // scroll instead of dumping everything. Tap "See more" to expand
  // in place — no extra screen, no extra fetch (we already have the
  // full 12 from useRecentActivity).
  const [activityExpanded, setActivityExpanded] = useState(false);

  const { xp: liveXp, streak: liveStreak, recordActivity, refresh: refreshGame } = useGameTracking();
  const flame = useRef(new Animated.Value(1)).current;

  const { papers, loading: papersLoading } = usePastPapers();
  const { rooms } = useRooms();
  const { items: feedItems, loading: feedLoading } = useDiscoverFeed();
  const { scoreFor } = useMatchScores();
  const { items: activity, loading: activityLoading } = useRecentActivity();

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('name, xp, streak, uni, major, pro')
      .eq('id', session.user.id)
      .maybeSingle();
    setProfile(data as ProfileLite | null);
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void recordActivity(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    const flameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flame, { toValue: 1.18, duration: 650, useNativeDriver: true }),
        Animated.timing(flame, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    flameLoop.start();
    return () => flameLoop.stop();
  }, [flame]);

  const firstName =
    profile?.name?.split(' ')[0] ??
    session?.user?.email?.split('@')[0] ??
    'there';

  const greet = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5)  return 'Up late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Hello';
    if (h < 21) return 'Good evening';
    return 'Still grinding';
  }, []);

  const xp = Math.max(liveXp, profile?.xp ?? 0);
  const streak = Math.max(liveStreak, profile?.streak ?? 0);
  const isPro = profile?.pro === true;

  // ONE best match — same ranking the Discover feed uses (help-asks
  // first, then live profiles, then ghosts).
  const topMatch = feedItems[0] ?? null;
  // ONE best paper — papers come pre-sorted newest first, so [0] is
  // the freshest contribution.
  const topPaper = papers[0] ?? null;

  const upcomingRooms = useMemo(() => {
    const todayPrefix = new Date().toISOString().slice(0, 16);
    const keyOf = (r: typeof rooms[number]) => `${r.date}T${r.time ?? '00:00'}`;
    const sorted = [...rooms].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    const upcoming = sorted.filter(r => keyOf(r) >= todayPrefix);
    if (upcoming.length > 0) return upcoming.slice(0, 3);
    return sorted.slice(-3).reverse();
  }, [rooms]);

  const teaserActivity = useMemo(
    () => (activityExpanded ? activity : activity.slice(0, 3)),
    [activity, activityExpanded],
  );
  const hasMoreActivity = !activityExpanded && activity.length > 3;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshGame()]);
    setRefreshing(false);
  };

  // sayHi() and openPaper() were removed when the duo cards switched
  // from per-item action buttons ("Say hi" / "Open") to a uniform
  // "View all" CTA that just navigates to the relevant tab.

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── 0. Ask Tony hero ──
            Compact port of the website's home "Ask AI" card (col-8 hero
            in src/features/home/HomeScreen.tsx). Contains its own
            italic-serif greeting, so we no longer render the standalone
            greetingLine above it — the hero owns the top of the screen.
            Submit (or chip tap) writes to MAGIC_PREFILL_KEY and
            navigates to /(tabs)/ai, where the composer auto-fills. */}
        <AskTonyHomeHero greet={greet} firstName={firstName} />

        {/* ── 0b. Thin AI-match banner ──
            Single-row entry point to /study-match. Same banner is also
            on Discover above the candidate list — both home and Discover
            now offer a one-tap pivot into "let the AIs decide if you'd
            study well together". Lives BETWEEN the Ask Tony hero and
            the duo row so the user sees it on first paint without
            having to scroll. */}
        <StudyMatchBanner />

        {/* ── 1. Two-up: ONE match + ONE past paper ──
            Per user annotation pass: each card is a TEASER for its
            full tab. Eyebrows are sentence-case nouns ("Study partner",
            "Past paper"), and the bottom CTA on both cards is a
            uniform "View all" that navigates to the relevant tab. We
            removed the old top-corner "All →" link (it was redundant
            with the bottom button) and the per-item actions
            (say-hi / open-PDF) — those still live one tap away in the
            tabs themselves. */}
        <View style={styles.duoRow}>
          {/* Study partner card */}
          <View style={[styles.duoCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={styles.duoHeader}>
              <Text style={[styles.eyebrow, { color: c.textMuted }]}>Study partner</Text>
            </View>

            {feedLoading && !topMatch ? (
              <View style={styles.duoBody}>
                <Text style={[styles.muted, { color: c.textMuted }]}>Looking…</Text>
              </View>
            ) : !topMatch ? (
              <Pressable
                onPress={() => { tap(); router.push('/(tabs)/discover'); }}
                style={styles.duoBody}
              >
                <View style={[styles.duoIconCircle, { backgroundColor: TONY_PURPLE_SOFT }]}>
                  <Ionicons name="people" size={20} color={TONY_PURPLE} />
                </View>
                <Text style={[styles.duoTitle, { color: c.text }]} numberOfLines={2}>
                  Find your study partner
                </Text>
                <Text style={[styles.duoMeta, { color: c.textMuted }]} numberOfLines={1}>
                  Open Discover →
                </Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.duoBody}>
                  <Avatar
                    emoji={topMatch.profile.avatar_emoji}
                    color={topMatch.profile.avatar_color}
                    photoUrl={topMatch.profile.photo_url}
                    name={topMatch.profile.name}
                    size={56}
                  />
                  <Text style={[styles.duoTitle, { color: c.text }]} numberOfLines={1}>
                    {topMatch.profile.name ?? 'Someone'}
                  </Text>
                  <Text style={[styles.duoMeta, { color: c.textMuted }]} numberOfLines={1}>
                    {[topMatch.profile.major, topMatch.profile.year ? `Year ${topMatch.profile.year}` : null]
                      .filter(Boolean).join(' · ') || '—'}
                  </Text>
                  {(() => {
                    const m = scoreFor(topMatch.profile);
                    return m ? (
                      <Text style={[styles.duoPct, { color: TONY_PURPLE }]}>{m.score}%</Text>
                    ) : null;
                  })()}
                </View>
                {/* "View all" jumps to Discover. The AI-match entry
                    point lives in the standalone <StudyMatchBanner />
                    above this duo row, so the card stays focused on
                    its primary "browse candidates" CTA. */}
                <Pressable
                  onPress={() => { tap(); router.push('/(tabs)/discover'); }}
                  style={({ pressed }) => [
                    styles.duoBtn,
                    { backgroundColor: TONY_PURPLE, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={styles.duoBtnText}>View all</Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </Pressable>
              </>
            )}
          </View>

          {/* Past paper card */}
          <View style={[styles.duoCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={styles.duoHeader}>
              <Text style={[styles.eyebrow, { color: c.textMuted }]}>Past paper</Text>
            </View>

            {papersLoading && !topPaper ? (
              <View style={styles.duoBody}>
                <Text style={[styles.muted, { color: c.textMuted }]}>Loading…</Text>
              </View>
            ) : !topPaper ? (
              <Pressable
                onPress={() => { tap(); router.push('/papers'); }}
                style={styles.duoBody}
              >
                <View style={[styles.duoIconCircle, { backgroundColor: TONY_PURPLE_SOFT }]}>
                  <Ionicons name="document-text" size={20} color={TONY_PURPLE} />
                </View>
                <Text style={[styles.duoTitle, { color: c.text }]} numberOfLines={2}>
                  Be the first to share
                </Text>
                <Text style={[styles.duoMeta, { color: c.textMuted }]} numberOfLines={1}>
                  Upload a past paper →
                </Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.duoBody}>
                  <View style={[styles.duoIconCircle, { backgroundColor: TONY_PURPLE_SOFT }]}>
                    <Ionicons name="document-text" size={22} color={TONY_PURPLE} />
                  </View>
                  <Text style={[styles.duoTitle, { color: c.text }]} numberOfLines={2}>
                    {topPaper.course_name}
                  </Text>
                  <Text style={[styles.duoMeta, { color: c.textMuted }]} numberOfLines={2}>
                    {paperSubline(topPaper)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => { tap(); router.push('/papers'); }}
                  style={({ pressed }) => [
                    styles.duoBtnGhost,
                    {
                      backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      borderColor: c.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.duoBtnGhostText, { color: c.text }]}>View all</Text>
                  <Ionicons name="arrow-forward" size={12} color={c.text} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* ── 2. Rooms today ── */}
        <View style={[styles.bentoCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <View style={styles.sectionHeadRow}>
            <Text style={[styles.serifH2, { color: c.text }]}>Rooms today</Text>
            <Pressable onPress={() => { tap(); router.push('/(tabs)/rooms'); }} hitSlop={8}>
              <Text style={[styles.seeAllLink, { color: c.accent }]}>See all</Text>
            </Pressable>
          </View>
          {upcomingRooms.length === 0 ? (
            <Pressable
              onPress={() => { tap(); router.push('/rooms/new'); }}
              style={[styles.emptyInline, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <Text style={{ fontSize: 24 }}>🪑</Text>
              <Text style={[styles.emptyInlineText, { color: c.textMuted }]}>
                No sessions yet — host one and rally your classmates.
              </Text>
            </Pressable>
          ) : (
            <View style={{ gap: space.sm }}>
              {upcomingRooms.map(r => (
                <Pressable
                  key={r.id}
                  onPress={() => { tap(); router.push('/(tabs)/rooms'); }}
                  style={({ pressed }) => [styles.roomRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <View
                    style={[
                      styles.roomIcon,
                      { backgroundColor: r.type === 'online' ? 'rgba(139,101,240,0.16)' : 'rgba(43,182,115,0.16)' },
                    ]}
                  >
                    <Ionicons
                      name={r.type === 'online' ? 'videocam' : 'people'}
                      size={18}
                      color={r.type === 'online' ? '#8b65f0' : '#2bb673'}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.roomTitle, { color: c.text }]} numberOfLines={1}>
                      {r.subject}
                    </Text>
                    <Text style={[styles.roomMeta, { color: c.textMuted }]} numberOfLines={1}>
                      {r.date} · {r.time?.slice(0, 5)} · {r.filled}/{r.spots} spots
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ── 3. Streak + XP ── */}
        <View style={[styles.bentoCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <View style={styles.eyebrowRow}>
            <Ionicons name="flame" size={13} color={c.textMuted} />
            <Text style={[styles.eyebrowText, { color: c.textMuted }]}>STREAK</Text>
          </View>
          <View style={styles.streakRow}>
            <Animated.Text
              style={[
                styles.streakNumber,
                { color: c.text, transform: [{ scale: flame }] },
              ]}
            >
              {streak}
            </Animated.Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.streakLabel, { color: c.text }]}>days in a row.</Text>
              <Text style={[styles.streakSub, { color: c.textMuted }]}>Keep it going.</Text>
            </View>
            <View style={[styles.xpBlock, { borderColor: c.border }]}>
              <Text style={[styles.xpNumber, { color: c.text }]}>
                <AnimatedNumber value={xp} />
              </Text>
              <Text style={[styles.xpLabel, { color: c.textMuted }]}>XP</Text>
            </View>
          </View>
          <View style={{ marginTop: space.sm }}>
            <XPBar xp={xp} />
          </View>
          <Pressable
            onPress={() => { thump(); router.push('/post-help'); }}
            style={({ pressed }) => [
              styles.streakCta,
              { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="add" size={14} color={dark ? '#000' : '#fff'} />
            <Text style={[styles.streakCtaText, { color: dark ? '#000' : '#fff' }]}>
              Post for help
            </Text>
          </Pressable>
        </View>

        {/* ── 4. Recent activity (teaser, 3 items + see more) ── */}
        <View style={[styles.bentoCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <Text style={[styles.serifH2, { color: c.text, marginBottom: space.md }]}>
            Recent activity
          </Text>
          {activityLoading ? (
            <Text style={[styles.muted, { color: c.textMuted }]}>Loading…</Text>
          ) : teaserActivity.length === 0 ? (
            <Text style={[styles.muted, { color: c.textMuted }]}>
              {session
                ? 'Quiet around here. Post for help or create a room to get the feed going.'
                : 'Sign in to see what your peers are doing right now.'}
            </Text>
          ) : (
            <View>
              {teaserActivity.map((f, i) => (
                <ActivityRow key={f.id} item={f} isLast={i === teaserActivity.length - 1 && !hasMoreActivity} />
              ))}
              {hasMoreActivity && (
                <Pressable
                  onPress={() => { tap(); setActivityExpanded(true); }}
                  style={({ pressed }) => [styles.seeMoreRow, { opacity: pressed ? 0.7 : 1 }]}
                  hitSlop={6}
                >
                  <Text style={[styles.seeMoreText, { color: c.accent }]}>
                    See {activity.length - 3} more
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={c.accent} />
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* ── 5. Upgrade to Pro ── */}
        {!isPro && (
          <Pressable
            onPress={() => { thump(); router.push('/upgrade'); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
          >
            <LinearGradient
              colors={['#ffb800', '#ff8c00', '#ff5500']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.proBanner}
            >
              <View style={styles.proRow}>
                <Text style={styles.proIcon}>👑</Text>
                <View style={styles.proText}>
                  <Text style={styles.proTitle}>Upgrade to Pro</Text>
                  <Text style={styles.proSub}>Unlimited Tony · ad-free · priority support</Text>
                </View>
                <View style={styles.proBtn}>
                  <Text style={styles.proBtnText}>Try free</Text>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function ActivityRow({ item, isLast }: { item: ActivityItem; isLast: boolean }) {
  const { c } = useTheme();
  const name = (item.actor?.name || '').trim() || 'Someone';
  return (
    <View
      style={[
        styles.activityRow,
        !isLast && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Avatar
        emoji={item.actor?.avatar_emoji}
        color={item.actor?.avatar_color}
        photoUrl={item.actor?.photo_url}
        name={name}
        size={36}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontSize: font.sizes.sm }} numberOfLines={2}>
          <Text style={{ fontWeight: '700' }}>{name}</Text> {item.verb}
        </Text>
        <Text style={[styles.activityTime, { color: c.textMuted }]}>
          {relativeTime(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // (greetingLine moved into AskTonyHomeHero — it owns the top of Home)

  // ── 2-up top duo (Match | Past paper) ─────────────────────────
  duoRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  duoCard: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.md,
    gap: space.sm,
    minHeight: 220,
    justifyContent: 'space-between',
  },
  duoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Sentence-case eyebrow ("Study partner" / "Past paper"). Slightly
  // larger than the old 10pt UPPERCASE label and no exaggerated
  // letter-spacing — caps-tuned tracking looks loose in sentence case.
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
  },
  duoBody: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  duoIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  duoTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 19,
    marginTop: 4,
  },
  duoMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  duoPct: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
    marginTop: 2,
  },
  duoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  duoBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12.5,
  },
  duoBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: 2,
  },
  duoBtnGhostText: {
    fontWeight: '600',
    fontSize: 12.5,
  },

  // ── bento cards ───────────────────────────────────────────────
  bentoCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  serifH2: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    letterSpacing: -0.3,
    flex: 1,
  },
  seeAllLink: { fontSize: font.sizes.sm, fontWeight: '600' },
  muted: { fontSize: font.sizes.sm, lineHeight: 19 },

  // ── streak + XP ───────────────────────────────────────────────
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: space.sm },
  eyebrowText: {
    fontSize: font.sizes.xs,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  streakNumber: {
    fontSize: 56,
    lineHeight: 60,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    letterSpacing: -1.4,
  },
  streakLabel: { fontSize: font.sizes.md, fontWeight: '600' },
  streakSub: { fontSize: font.sizes.sm, marginTop: 1 },
  xpBlock: {
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  xpNumber: { fontSize: 18, fontWeight: '700' },
  xpLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  streakCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    marginTop: space.md,
  },
  streakCtaText: { fontSize: font.sizes.xs, fontWeight: '700', letterSpacing: 0.3 },

  // ── rooms ─────────────────────────────────────────────────────
  emptyInline: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  emptyInlineText: { fontSize: font.sizes.sm, textAlign: 'center', lineHeight: 19 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 4 },
  roomIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  roomTitle: { fontSize: font.sizes.sm, fontWeight: '700' },
  roomMeta: { fontSize: font.sizes.xs, marginTop: 1 },

  // ── activity teaser ───────────────────────────────────────────
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.sm,
  },
  activityTime: { fontSize: 11, marginTop: 2 },
  seeMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: space.md,
    paddingBottom: 2,
  },
  seeMoreText: { fontSize: font.sizes.sm, fontWeight: '600' },

  // ── upgrade banner ────────────────────────────────────────────
  proBanner: { borderRadius: radius.xl, padding: space.lg, overflow: 'hidden' },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  proIcon: { fontSize: 28 },
  proText: { flex: 1, gap: 2 },
  proTitle: { fontSize: font.sizes.lg, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  proSub: { fontSize: font.sizes.sm, color: 'rgba(255,255,255,0.85)', lineHeight: 17 },
  proBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  proBtnText: { color: '#fff', fontWeight: '700', fontSize: font.sizes.sm },
});
