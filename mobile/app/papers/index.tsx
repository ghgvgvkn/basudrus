/**
 * Past Papers — browse + filter shared past papers, with a floating
 * upload button.
 *
 * v2 changes (per user "the search bar is on the clock and the battery
 * on the iPhone … it should be served by university and then or by
 * course and there should be something where you could upload"):
 *
 *   1. STATUS-BAR FIX. The root stack hides its header globally
 *      (app/_layout.tsx → headerShown:false), so the screen owns its
 *      own top inset. We now start the search header at
 *      `insets.top + space.md` instead of `space.md`, so iPhone notch /
 *      Dynamic Island / status bar can't overlap the search field.
 *   2. GROUP BY UNIVERSITY → COURSE. Instead of one flat list ordered
 *      by created_at, the results are now sectioned: a collapsible
 *      university header → an inner course header → the paper cards.
 *      This matches how students actually look for papers ("show me
 *      everything from PSUT, Operating Systems" first, not "the most
 *      recent thing anyone uploaded").
 *   3. UPLOAD FAB. A circular accent-tinted "+" button pinned to the
 *      bottom-right (same shape language as the Help-Request FAB on
 *      Home) opens /papers/upload — the new mobile upload form.
 *   4. Search now matches uni / course / professor / topics, not just
 *      course name, so a user typing "Hamdan" or "trees" finds a hit.
 *
 * Carried over from v1:
 *   - Exam-type filter pills (All / Midterm / Final / Quiz / Practice).
 *   - Tap a card → opens the file URL in the system browser.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePastPapers, type ExamType, type PastPaperRow } from '@/hooks/usePastPapers';
import { tap, thump } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

const EXAM_FILTERS = [
  { key: null,         label: 'All' },
  { key: 'midterm',   label: 'Midterm' },
  { key: 'final',     label: 'Final' },
  { key: 'quiz',      label: 'Quiz' },
  { key: 'practice',  label: 'Practice' },
] as const;

function examColors(type: string | null, dark: boolean) {
  switch (type) {
    case 'final':    return { bg: dark ? 'rgba(255,70,70,0.18)' : 'rgba(220,30,30,0.10)', text: dark ? '#ff5050' : '#cc2020' };
    case 'midterm':  return { bg: dark ? 'rgba(255,165,0,0.18)' : 'rgba(200,110,0,0.10)', text: dark ? '#ffa500' : '#995500' };
    case 'quiz':     return { bg: dark ? 'rgba(0,212,255,0.18)' : 'rgba(0,100,210,0.10)', text: dark ? '#00d4ff' : '#0055cc' };
    case 'practice': return { bg: dark ? 'rgba(57,210,122,0.18)' : 'rgba(30,150,80,0.10)', text: dark ? '#39d27a' : '#1a8040' };
    default:         return { bg: dark ? 'rgba(150,150,150,0.15)' : 'rgba(100,100,100,0.10)', text: dark ? '#aaa' : '#666' };
  }
}

function semesterLabel(s: string | null) {
  const map: Record<string, string> = { fall: 'Fall', spring: 'Spring', summer: 'Summer' };
  return s ? (map[s] ?? s) : null;
}

type CourseGroup = {
  key: string;
  course_name: string;
  course_code: string | null;
  papers: PastPaperRow[];
};
type UniGroup = {
  uni: string;
  papers: PastPaperRow[];
  courses: CourseGroup[];
};

/** Build the uni → course tree the user wanted, sorted by paper count. */
function groupPapers(papers: PastPaperRow[]): UniGroup[] {
  const uniMap = new Map<string, PastPaperRow[]>();
  for (const p of papers) {
    const uni = (p.uni ?? 'Other').trim() || 'Other';
    const arr = uniMap.get(uni) ?? [];
    arr.push(p);
    uniMap.set(uni, arr);
  }

  const result: UniGroup[] = [];
  for (const [uni, list] of uniMap.entries()) {
    const courseMap = new Map<string, CourseGroup>();
    for (const p of list) {
      const cname = (p.course_name ?? 'Other').trim() || 'Other';
      const ccode = (p.course_code ?? '').trim() || null;
      const key = (ccode ?? '') + '::' + cname.toLowerCase();
      const existing = courseMap.get(key);
      if (existing) {
        existing.papers.push(p);
      } else {
        courseMap.set(key, {
          key,
          course_name: cname,
          course_code: ccode,
          papers: [p],
        });
      }
    }
    const courses = Array.from(courseMap.values()).sort(
      (a, b) => b.papers.length - a.papers.length || a.course_name.localeCompare(b.course_name),
    );
    result.push({ uni, papers: list, courses });
  }
  return result.sort(
    (a, b) => b.papers.length - a.papers.length || a.uni.localeCompare(b.uni),
  );
}

export default function PapersScreen() {
  const { mode, c } = useTheme();
  const dark = mode === 'dark';
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [examFilter, setExamFilter] = useState<ExamType | null>(null);
  const [collapsedUnis, setCollapsedUnis] = useState<Set<string>>(new Set());

  const { papers, loading, error, refresh } = usePastPapers();

  // Search matches uni / course / code / professor / topics — anything
  // a student might type. Case-insensitive substring.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return papers
      .filter(p => !examFilter || p.exam_type === examFilter)
      .filter(p => {
        if (!q) return true;
        const haystack = [
          p.uni,
          p.course_name,
          p.course_code ?? '',
          p.professor_name ?? '',
          ...(p.topics_covered ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
  }, [papers, examFilter, search]);

  const groups = useMemo(() => groupPapers(filtered), [filtered]);

  const toggleUni = (uni: string) => {
    tap();
    setCollapsedUnis(prev => {
      const next = new Set(prev);
      if (next.has(uni)) next.delete(uni);
      else next.add(uni);
      return next;
    });
  };

  const openFile = async (url: string | null) => {
    if (!url) return;
    tap();
    try {
      await Linking.openURL(url);
    } catch {
      /* ignore — can't open */
    }
  };

  const openUpload = () => {
    thump();
    router.push('/papers/upload');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {/* ─── Header (with safe-area top padding) ─── */}
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + space.sm,
              backgroundColor: c.bg,
              borderBottomColor: c.border,
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={16}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={26} color={c.text} />
            </Pressable>
            <Text style={[styles.title, { color: c.text }]}>Past Papers</Text>
            <View style={{ width: 30 }} />
          </View>

          {/* Search */}
          <View style={[styles.searchBar, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <Ionicons name="search" size={17} color={c.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by uni, course, professor, topic…"
              placeholderTextColor={c.textFaint}
              clearButtonMode="while-editing"
              autoCorrect={false}
              style={[styles.searchInput, { color: c.text }]}
            />
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            {EXAM_FILTERS.map(f => {
              const active = f.key === examFilter;
              return (
                <Pressable
                  key={String(f.key)}
                  onPress={() => { tap(); setExamFilter(active ? null : (f.key as ExamType | null)); }}
                  style={[
                    styles.pill,
                    active
                      ? { backgroundColor: c.accent }
                      : { backgroundColor: c.bgCard, borderColor: c.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.pillText, { color: active ? '#000' : c.textMuted }]}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ─── Body ─── */}
        {loading ? (
          <ActivityIndicator color={c.textMuted} style={{ flex: 1 }} />
        ) : error ? (
          <View style={styles.center}>
            <Text style={{ color: c.danger, textAlign: 'center' }}>{error}</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 40 }}>📭</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>
              {search ? 'Nothing matched that search.' : 'No shared papers yet.'}
            </Text>
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {search
                ? 'Try a different term or clear filters.'
                : 'Be the first — tap the + to share one.'}
            </Text>
            <Pressable
              onPress={openUpload}
              style={({ pressed }) => [
                styles.emptyCta,
                { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="cloud-upload-outline" size={16} color="#000" />
              <Text style={styles.emptyCtaText}>Upload a paper</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              padding: space.xl,
              paddingTop: space.lg,
              paddingBottom: insets.bottom + 140,
              gap: space.xl,
            }}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.textMuted} />
            }
            showsVerticalScrollIndicator={false}
          >
            {groups.map(g => {
              const collapsed = collapsedUnis.has(g.uni);
              return (
                <View key={g.uni} style={styles.uniGroup}>
                  {/* University header */}
                  <Pressable
                    onPress={() => toggleUni(g.uni)}
                    style={({ pressed }) => [
                      styles.uniHeader,
                      {
                        backgroundColor: c.bgCard,
                        borderColor: c.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.uniIconWrap, { backgroundColor: c.accentSoft }]}>
                      <Ionicons name="school" size={16} color={c.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.uniName, { color: c.text }]} numberOfLines={1}>
                        {g.uni}
                      </Text>
                      <Text style={[styles.uniMeta, { color: c.textMuted }]}>
                        {g.courses.length} course{g.courses.length === 1 ? '' : 's'} · {g.papers.length} paper{g.papers.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Ionicons
                      name={collapsed ? 'chevron-down' : 'chevron-up'}
                      size={18}
                      color={c.textMuted}
                    />
                  </Pressable>

                  {/* Courses inside */}
                  {!collapsed && g.courses.map(course => (
                    <View key={course.key} style={styles.courseGroup}>
                      <View style={styles.courseHeaderRow}>
                        <Ionicons name="book-outline" size={13} color={c.textMuted} />
                        <Text style={[styles.courseHeaderText, { color: c.textMuted }]} numberOfLines={1}>
                          {course.course_name}
                          {course.course_code ? `  ·  ${course.course_code}` : ''}
                        </Text>
                        <Text style={[styles.courseCount, { color: c.textFaint }]}>
                          {course.papers.length}
                        </Text>
                      </View>

                      {course.papers.map(p => {
                        const ec = examColors(p.exam_type, dark);
                        const sem = semesterLabel(p.semester);
                        const hasFile = !!p.file_url;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => openFile(p.file_url)}
                            style={({ pressed }) => [
                              styles.card,
                              {
                                backgroundColor: c.bgCard,
                                borderColor: c.border,
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}
                          >
                            <View style={styles.cardTop}>
                              <View style={[styles.badge, { backgroundColor: ec.bg }]}>
                                <Text style={[styles.badgeText, { color: ec.text }]}>
                                  {(p.exam_type ?? 'exam').toUpperCase()}
                                </Text>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                                {p.year ? (
                                  <Text style={[styles.meta, { color: c.textFaint }]}>
                                    {p.year}{sem ? ` · ${sem}` : ''}
                                  </Text>
                                ) : null}
                                {p.verified ? (
                                  <Ionicons name="checkmark-circle" size={14} color={c.success} />
                                ) : null}
                              </View>
                            </View>

                            {p.professor_name ? (
                              <Text style={[styles.metaLine, { color: c.textMuted }]} numberOfLines={1}>
                                {p.professor_name}
                              </Text>
                            ) : null}

                            {p.topics_covered?.length > 0 ? (
                              <View style={styles.topicsRow}>
                                {p.topics_covered.slice(0, 4).map(t => (
                                  <View key={t} style={[styles.topicChip, { backgroundColor: c.bg, borderColor: c.border }]}>
                                    <Text style={[styles.topicText, { color: c.textMuted }]}>{t}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}

                            {hasFile ? (
                              <View style={styles.downloadRow}>
                                <Ionicons name="document-text-outline" size={14} color={c.accent} />
                                <Text style={[styles.downloadText, { color: c.accent }]}>Open PDF</Text>
                              </View>
                            ) : (
                              <Text style={[styles.meta, { color: c.textFaint, marginTop: space.sm }]}>
                                No file attached
                              </Text>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* ─── Floating upload button ─── */}
        <Pressable
          onPress={openUpload}
          style={({ pressed }) => [
            styles.fab,
            {
              bottom: insets.bottom + 24,
              backgroundColor: c.accent,
              transform: [{ scale: pressed ? 0.94 : 1 }],
              shadowColor: dark ? '#000' : c.accent,
            },
          ]}
          accessibilityLabel="Upload a past paper"
        >
          <Ionicons name="add" size={28} color={dark ? '#000' : '#fff'} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    height: 44,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.sizes.lg,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.xl,
    marginTop: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sizes.md,
    height: 42,
  },
  pillRow: {
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  pill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.semibold,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  emptyTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, textAlign: 'center' },
  emptyText: { fontSize: font.sizes.md, textAlign: 'center', lineHeight: 22 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    marginTop: space.sm,
  },
  emptyCtaText: { color: '#000', fontWeight: font.weights.bold, fontSize: font.sizes.md },

  // Uni group
  uniGroup: { gap: space.md },
  uniHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  uniIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uniName: { fontSize: font.sizes.md, fontWeight: font.weights.bold },
  uniMeta: { fontSize: font.sizes.xs },

  // Course group
  courseGroup: { gap: space.sm, marginLeft: space.sm },
  courseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.xs,
    marginTop: space.xs,
  },
  courseHeaderText: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weights.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  courseCount: {
    fontSize: 11,
    fontWeight: font.weights.semibold,
  },

  // Paper card
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    gap: space.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, letterSpacing: 0.5 },
  metaLine: { fontSize: font.sizes.sm, lineHeight: 18 },
  meta: { fontSize: font.sizes.xs },
  topicsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  topicChip: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  topicText: { fontSize: font.sizes.xs },
  downloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
  },
  downloadText: { fontSize: font.sizes.sm, fontWeight: font.weights.medium },

  // FAB
  fab: {
    position: 'absolute',
    right: space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
});
