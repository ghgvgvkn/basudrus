/**
 * Discover — find study partners and help requests at your university.
 *
 * v6 (per user feedback on the v5 search input — "the search for the
 * courses should be a real search for the courses because it's not
 * connected to it"):
 *   - Search is now a TYPEAHEAD over `course_catalog` (~5,500 canonical
 *     rows) via `useCourseSearch`, matching the web Discover screen's
 *     CourseCombobox. Tapping a row LOCKS that course as the active
 *     filter and passes it to `useDiscoverFeed.course`, which then
 *     runs `subjects @> [course]` server-side. No more "I typed
 *     'OOP' but it didn't match anyone's saved subjects" mystery.
 *   - The AI-match banner uses the new `variant="mono"` per the same
 *     brief: "you could keep the black colour instead of the blue
 *     one" — the icon tile renders solid near-black so it pairs
 *     visually with the Discover filter button's active state.
 *   - Help-askers-first ordering is preserved (already handled inside
 *     `useDiscoverFeed.items`: ask rows first, then active members,
 *     then ghost sign-ups — see hook docstring).
 *
 * v5: search box courses-only string match.
 * v4: typeable university + major filters from the Supabase catalog.
 * v3: filter sheet, help-asks first, FAB, UnifiedCard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FAB } from '@/components/FAB';
import { FilterSheet, type DraftFilters } from '@/components/FilterSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UnifiedCard } from '@/components/UnifiedCard';
import type { TypeaheadOption } from '@/components/TypeaheadField';
import { useDiscoverFeed, type FeedItem } from '@/hooks/useDiscoverFeed';
import { useGameTracking } from '@/hooks/useGameTracking';
import { useUniversities, useAllMajors } from '@/hooks/useUniversities';
import { useCourseSearch } from '@/hooks/useCourseSearch';
import { usePlatformStats } from '@/hooks/usePlatformStats';
import { thump, success as hSuccess, error as hError, tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { supabase } from '@/lib/supabase';
import { StudyMatchBanner } from '@/components/StudyMatchBanner';

/** Dedup + sort a list of strings, dropping empties. */
const uniqSorted = (xs: (string | null | undefined)[]): string[] =>
  Array.from(new Set(xs.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b),
  );

export default function DiscoverScreen() {
  const { c, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // The search input holds raw text the user is typing. When they tap
  // a row in the dropdown we commit it to `courseFilter`, which is the
  // value that actually drives the feed query. Keeping these separate
  // means typing "calc" doesn't filter until the user picks a real
  // course — which matches the web Discover UX and avoids the
  // confusing "I typed something and now there's nothing here" state.
  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const [filters, setFilters] = useState<DraftFilters>({
    uni: null,
    major: null,
    year: null,
  });
  const [sheetOpen, setSheetOpen] = useState(false);

  // Feed driven by committed filters + the locked course. The hook
  // applies all of these server-side (uni/major ILIKE, year eq,
  // course = subjects-array contains) so the unified items[] we get
  // back is already correctly filtered AND already sorted help-asks
  // first → active members → ghost sign-ups.
  const { items, profiles, loading, refresh } = useDiscoverFeed({
    uni: filters.uni,
    major: filters.major,
    year: filters.year,
    course: courseFilter,
  });
  const { awardXP } = useGameTracking();

  // Live platform-wide student count — auto-updates the moment a new
  // student signs up or one deletes their account. Matches the web
  // Discover screen's "Showing X of Y students" line. The query is a
  // count-only `head: true` SELECT so each refresh is one integer
  // over the wire.
  const { totalStudents, ready: statsReady } = usePlatformStats();

  // ── Course search (typeahead) ─────────────────────────────────────
  // Empty query → most-offered courses bubble up. Typing → ILIKE
  // matches sorted by popularity. Dropdown is shown only while the
  // input is focused AND there's no locked course (once you've picked
  // one, the input shows the course name and the dropdown closes).
  const { results: courseSuggestions, loading: courseLoading } =
    useCourseSearch(searchQuery);

  // Keep the input text in sync if courseFilter changes externally
  // (e.g. someone taps the pill to clear it — see clearAll below).
  // Without this the input would still display the old course name.
  useEffect(() => {
    if (!courseFilter) setSearchQuery('');
    else if (courseFilter !== searchQuery) setSearchQuery(courseFilter);
    // searchQuery intentionally omitted — only react to courseFilter
    // changes; we don't want this firing on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseFilter]);

  // ── Filter options ────────────────────────────────────────────────
  const { unis: catalogUnis } = useUniversities();
  const { majors: catalogMajors } = useAllMajors();

  const universityOptions = useMemo<TypeaheadOption[]>(
    () => catalogUnis.map(u => ({
      id: u.id,
      label: u.name,
      sublabel: [u.city, u.country].filter(Boolean).join(' · ') || null,
    })),
    [catalogUnis],
  );
  const majorOptions = useMemo<TypeaheadOption[]>(
    () => catalogMajors.map(m => ({ id: m.id, label: m.name })),
    [catalogMajors],
  );

  const years = useMemo(() => uniqSorted(profiles.map(p => p.year)), [profiles]);

  // `items` already comes back filtered (course/uni/major/year applied
  // by the hook) AND sorted help-asks first. No more local subjects[]
  // string filter — the server query is the single source of truth.
  const visible = items;

  const askCount = useMemo(
    () => visible.filter(it => !!it.helpRequest).length,
    [visible],
  );
  const activeFilterCount =
    Object.values(filters).filter(Boolean).length + (courseFilter ? 1 : 0);

  const sayHi = async (partnerId: string) => {
    thump();
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) return;

      const { error } = await supabase
        .from('connections')
        .upsert(
          { user_id: user.id, partner_id: partnerId },
          { onConflict: 'user_id,partner_id' },
        );

      if (!error) {
        hSuccess();
        void awardXP(3);
        router.push(`/chat/${partnerId}`);
      } else {
        hError();
      }
    } catch {
      hError();
    }
  };

  const clearAll = () => {
    tap();
    setFilters({ uni: null, major: null, year: null });
    setCourseFilter(null);
    setSearchQuery('');
  };

  // Lock in a course pick from the dropdown. Closes the keyboard so
  // the user immediately sees the freshly filtered feed instead of
  // having to dismiss the keyboard first.
  const pickCourse = (name: string) => {
    tap();
    setCourseFilter(name);
    setSearchQuery(name);
    setSearchFocused(false);
    Keyboard.dismiss();
  };

  const clearCourse = () => {
    tap();
    setCourseFilter(null);
    setSearchQuery('');
  };

  // Subtitle copy. Two product requirements from the user brief:
  //   1. Show "Showing X of Y students" — Y is the live platform-wide
  //      count from usePlatformStats (matches the website's Discover
  //      copy), not the in-feed count which is capped at 120.
  //   2. If the platform has fewer than 10 students, suppress the
  //      count entirely. Showing "Showing 3 of 4 students" makes the
  //      product look empty; better to lead with the help-ask count
  //      (or fall back to a generic line) until the network has real
  //      density.
  //
  // We treat `statsReady === false` and `totalStudents < 10` the same
  // way — both hide the platform total. While loading, the help-ask
  // line still surfaces if there are any so the page never reads as
  // dead air.
  const SHOW_COUNT_THRESHOLD = 10;
  const hasPlatformDensity =
    statsReady && typeof totalStudents === 'number' && totalStudents >= SHOW_COUNT_THRESHOLD;

  let subtitle: string;
  if (askCount > 0 && hasPlatformDensity) {
    subtitle = `${askCount} asking for help · Showing ${visible.length} of ${totalStudents!.toLocaleString()} students`;
  } else if (hasPlatformDensity) {
    subtitle = `Showing ${visible.length} of ${totalStudents!.toLocaleString()} students`;
  } else if (askCount > 0) {
    subtitle = `${askCount} student${askCount === 1 ? '' : 's'} asking for help`;
  } else {
    subtitle = 'Find study partners at your university';
  }

  // Show the dropdown when the input is focused AND either:
  //   1. There's no locked course yet (initial state — show popular
  //      courses so the user has something to tap immediately), OR
  //   2. The user has edited the text away from the locked course
  //      name (they're searching for a different one).
  const showDropdown =
    searchFocused &&
    (!courseFilter || searchQuery.trim().toLowerCase() !== courseFilter.toLowerCase());

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={visible}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 140,
          paddingHorizontal: space.xl,
        }}
        refreshing={loading}
        onRefresh={refresh}
        ListHeaderComponent={
          <>
            <ScreenHeader title="Discover" subtitle={subtitle} serif />

            {/* Search + Filter row. The search input is a course
                typeahead — see CourseTypeahead below. */}
            <View style={styles.controlsRow}>
              <View style={{ flex: 1 }}>
                <CourseTypeahead
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  focused={searchFocused}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    // Delay so a tap on a dropdown row still registers
                    // (RN closes keyboard before press fires otherwise).
                    setTimeout(() => setSearchFocused(false), 150);
                  }}
                  locked={!!courseFilter}
                  onClear={clearCourse}
                />
              </View>

              <Pressable
                onPress={() => { tap(); setSheetOpen(true); }}
                style={({ pressed }) => [
                  styles.filterBtn,
                  {
                    backgroundColor:
                      activeFilterCount > 0
                        ? mode === 'dark' ? c.accent : '#111111'
                        : c.bgElevated,
                    borderColor:
                      activeFilterCount > 0
                        ? mode === 'dark' ? c.accent : '#111111'
                        : c.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="options-outline"
                  size={18}
                  color={
                    activeFilterCount > 0
                      ? mode === 'dark' ? '#000' : '#fff'
                      : c.text
                  }
                />
                {activeFilterCount > 0 ? (
                  <View
                    style={[
                      styles.filterBadge,
                      { backgroundColor: mode === 'dark' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterBadgeText,
                        { color: mode === 'dark' ? '#000' : '#fff' },
                      ]}
                    >
                      {activeFilterCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>

            {/* Course suggestion dropdown — rendered inline (not as
                an absolute overlay) so the FlatList scrolls naturally
                with it. Shows real `course_catalog` rows; tap one to
                lock it in as the filter. */}
            {showDropdown ? (
              <View
                style={[
                  styles.dropdown,
                  { backgroundColor: c.bgCard, borderColor: c.border },
                ]}
              >
                {courseLoading && courseSuggestions.length === 0 ? (
                  <View style={styles.dropdownEmpty}>
                    <Text style={{ color: c.textMuted, fontSize: font.sizes.sm }}>
                      Searching courses…
                    </Text>
                  </View>
                ) : courseSuggestions.length === 0 ? (
                  <View style={styles.dropdownEmpty}>
                    <Text style={{ color: c.textMuted, fontSize: font.sizes.sm }}>
                      No course matches that. Try a code (e.g. CS 201) or topic.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: 260 }}
                  >
                    {courseSuggestions.map((course, i) => {
                      // Split "CS 201 · Data Structures" into a code
                      // chip + the rest, matching the web look.
                      const m = course.name.match(
                        /^([A-Z]{2,}\s?\d{2,4}[A-Z]?)\s*[\u00B7\-:]?\s*(.*)$/,
                      );
                      const code = m?.[1];
                      const rest = m?.[2] || course.name;
                      return (
                        <Pressable
                          key={course.id}
                          onPress={() => pickCourse(course.name)}
                          style={({ pressed }) => [
                            styles.dropdownRow,
                            {
                              backgroundColor: pressed ? c.bgElevated : 'transparent',
                              borderBottomColor: c.border,
                              borderBottomWidth:
                                i === courseSuggestions.length - 1 ? 0 : StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          {code ? (
                            <View
                              style={[
                                styles.courseCode,
                                { backgroundColor: c.bgElevated, borderColor: c.border },
                              ]}
                            >
                              <Text
                                style={[styles.courseCodeText, { color: c.text }]}
                                numberOfLines={1}
                              >
                                {code}
                              </Text>
                            </View>
                          ) : null}
                          <Text
                            style={[styles.courseName, { color: c.text }]}
                            numberOfLines={1}
                          >
                            {rest || course.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ) : null}

            {/* Thin "Try AI match" banner — single tap into the
                AI-to-AI Study Match flow. Lives between the controls
                row and the active-filter pills so it's always visible
                regardless of whether filters are active. Uses the
                default 'accent' variant so the Tony-purple sparkle
                pops — user reverted from the brief mono experiment:
                "can you return back the icon of the try AI match
                though with the colours?" */}
            <StudyMatchBanner style={{ marginBottom: space.md }} />

            {/* Active filter pills — click to clear individually */}
            {(filters.uni || filters.major || filters.year || courseFilter) ? (
              <View style={styles.activePillRow}>
                {filters.uni ? (
                  <ActivePill
                    label={filters.uni}
                    onClear={() => setFilters(f => ({ ...f, uni: null }))}
                  />
                ) : null}
                {filters.major ? (
                  <ActivePill
                    label={filters.major}
                    onClear={() => setFilters(f => ({ ...f, major: null }))}
                  />
                ) : null}
                {filters.year ? (
                  <ActivePill
                    label={`Year ${filters.year}`}
                    onClear={() => setFilters(f => ({ ...f, year: null }))}
                  />
                ) : null}
                {courseFilter ? (
                  <ActivePill label={courseFilter} onClear={clearCourse} />
                ) : null}
                {activeFilterCount > 1 ? (
                  <Pressable
                    onPress={clearAll}
                    style={({ pressed }) => [
                      styles.clearAllBtn,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={[styles.clearAllText, { color: c.textMuted }]}>
                      Clear all
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                {activeFilterCount > 0 ? 'No matches.' : 'No students yet.'}
              </Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                {activeFilterCount > 0
                  ? 'Try clearing filters or searching for a different course.'
                  : 'Post a help request and others will see it here as soon as they join.'}
              </Text>
              {activeFilterCount > 0 ? (
                <Pressable
                  onPress={clearAll}
                  style={({ pressed }) => [
                    styles.emptyCta,
                    {
                      backgroundColor: mode === 'dark' ? c.accent : '#111',
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: mode === 'dark' ? '#000' : '#fff', fontWeight: '700' }}>
                    Clear filters
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => { thump(); router.push('/post-help'); }}
                  style={({ pressed }) => [
                    styles.emptyCta,
                    {
                      backgroundColor: mode === 'dark' ? c.accent : '#111',
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: mode === 'dark' ? '#000' : '#fff', fontWeight: '700' }}>
                    Post a help request
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }: { item: FeedItem }) => (
          <UnifiedCard item={item} onConnect={() => sayHi(item.profile.id)} />
        )}
      />

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => setFilters(next)}
        onReset={() => setFilters({ uni: null, major: null, year: null })}
        initial={filters}
        universityOptions={universityOptions}
        majorOptions={majorOptions}
        years={years}
        matchCount={visible.length}
      />

      <FAB
        icon="add"
        label="Post help"
        onPress={() => router.push('/post-help')}
        accessibilityLabel="Post a help request"
      />
    </View>
  );
}

/**
 * CourseTypeahead — the search pill on Discover. Wraps a TextInput,
 * handles focus/blur, and shows a clear button when a course is
 * locked. The dropdown itself lives on the parent (so it can sit
 * inside the FlatList header without z-index gymnastics).
 */
function CourseTypeahead({
  query,
  onQueryChange,
  focused,
  onFocus,
  onBlur,
  locked,
  onClear,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  locked: boolean;
  onClear: () => void;
}) {
  const { c } = useTheme();
  const inputRef = useRef<TextInput>(null);
  return (
    <View
      style={[
        styles.searchPill,
        {
          backgroundColor: c.bgElevated,
          borderColor: focused ? c.text : c.border,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={c.textFaint} />
      <TextInput
        ref={inputRef}
        value={query}
        onChangeText={onQueryChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search courses — Calculus, OOP…"
        placeholderTextColor={c.textFaint}
        style={[styles.searchInput, { color: c.text }]}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {locked || query.length > 0 ? (
        <Pressable onPress={onClear} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={c.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ActivePill({ label, onClear }: { label: string; onClear: () => void }) {
  const { c, mode } = useTheme();
  return (
    <Pressable
      onPress={() => { tap(); onClear(); }}
      style={({ pressed }) => [
        styles.activePill,
        {
          backgroundColor: mode === 'dark' ? '#222' : '#111111',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.activePillText, { color: mode === 'dark' ? c.text : '#fff' }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="close" size={12} color={mode === 'dark' ? c.textMuted : 'rgba(255,255,255,0.7)'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controlsRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.md,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sizes.md,
    paddingVertical: 0,
  },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: font.weights.bold,
  },

  // Course suggestion dropdown — sits between the search row and the
  // banner, only when the input is focused and the user hasn't locked
  // a course yet.
  dropdown: {
    marginTop: -space.sm,
    marginBottom: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownEmpty: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  courseCode: {
    minWidth: 56,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseCodeText: {
    fontSize: 11,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.2,
  },
  courseName: {
    flex: 1,
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
  },

  activePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: space.md,
    alignItems: 'center',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    maxWidth: 200,
  },
  activePillText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.semibold,
  },
  clearAllBtn: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  clearAllText: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.medium,
    textDecorationLine: 'underline',
  },

  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
  },
  emptyTitle: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
  },
  emptyBody: {
    fontSize: font.sizes.md,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyCta: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    marginTop: space.sm,
  },
});
