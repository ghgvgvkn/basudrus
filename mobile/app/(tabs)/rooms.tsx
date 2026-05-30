/**
 * Rooms v2 — study rooms from `group_rooms`.
 *
 * What changed vs v1 (which the user called "a very big problem"):
 *   1. Create a room IN-APP — pushes /rooms/new. v1 told users to "go
 *      to the website" which is a dead end in a native app.
 *   2. Filter chips: All · Today · This Week · Online · In-Person.
 *      Replaces the auto-grouping that was buggy (past rooms showed
 *      as "Today" because of a < now+1day check).
 *   3. Past rooms are hidden — you don't want to join yesterday.
 *   4. Each card uses the room's "type" (online vs in-person) for an
 *      accent color and an icon, so the list isn't a wall of grey.
 *   5. Empty state has a big CTA, not "go to the website".
 *   6. Host can long-press their own room to delete.
 *   7. Animated card scale on press for tactile feedback.
 *   8. Pro upgrade banner when user has no rooms and could pay for
 *     "Squad" plan (group/family).
 */
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useRooms, type RoomFeedItem } from '@/hooks/useRooms';
import { useGameTracking } from '@/hooks/useGameTracking';
import { thump, tap, success as hSuccess, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { supabase } from '@/lib/supabase';
import { useMatchScores } from '@/hooks/useMatchScores';

type FilterKey = 'all' | 'today' | 'week' | 'online' | 'in_person';

const FILTERS: { key: FilterKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all',       label: 'All',         icon: 'apps' },
  { key: 'today',     label: 'Today',       icon: 'sunny' },
  { key: 'week',      label: 'This Week',   icon: 'calendar' },
  { key: 'online',    label: 'Online',      icon: 'videocam' },
  { key: 'in_person', label: 'In Person',   icon: 'people' },
];

const TYPE_COLOR = {
  online:    { fg: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.32)' },
  in_person: { fg: '#39d27a', bg: 'rgba(57,210,122,0.12)',  border: 'rgba(57,210,122,0.32)'  },
};

/** Parse a room's date+time into ms epoch. Returns null if invalid. */
function parseWhen(date?: string, time?: string): number | null {
  if (!date) return null;
  const iso = `${date}T${(time ?? '00:00').slice(0, 5)}:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function whenText(date?: string, time?: string): string {
  const t = parseWhen(date, time);
  if (t == null) return [date, time].filter(Boolean).join(' · ') || 'TBD';
  const d = new Date(t);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const day = isToday
    ? 'Today'
    : isTomorrow
      ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const tm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${tm}`;
}

export default function RoomsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rooms, loading, refresh, toggleJoin, deleteRoom } = useRooms();
  const { awardXP } = useGameTracking();
  const [filter, setFilter] = useState<FilterKey>('all');

  // Filter applied. Memoised so we don't re-walk on every render.
  //
  // Used to hide rooms >2h past, which broke the production list — the seed
  // rooms are dated April/May 2026 (real classes that recur weekly) and the
  // website happily shows them as "Rooms today" regardless of timestamp.
  // We now mirror that behaviour: all rooms show by default, and the chips
  // narrow by relative window.
  const visible = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return rooms.filter(r => {
      const when = parseWhen(r.date, r.time);
      if (filter === 'today') {
        return when != null && when >= todayMs && when < todayMs + DAY;
      }
      if (filter === 'week') {
        // ±7 day window so recurring weekly classes (last week + next week)
        // both show up. Matches the web "this week" semantics.
        return when != null && when >= now - 7 * DAY && when <= now + 7 * DAY;
      }
      if (filter === 'online')    return r.type === 'online';
      if (filter === 'in_person') return r.type === 'in_person';
      return true; // 'all' — show every room, no time clamp
    });
  }, [rooms, filter]);

  const onJoin = async (room: RoomFeedItem) => {
    thump();
    const wasJoined = room.joined;
    const res = await toggleJoin(room);
    if (res.ok) {
      hSuccess();
      // +10 XP for joining a room. Leaving is free (no penalty).
      if (!wasJoined) void awardXP(10);
    } else {
      hError();
    }
  };

  const onLongPress = async (room: RoomFeedItem) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const me = sessionData.session?.user?.id;
    if (me !== room.host_id) return;
    thump();
    Alert.alert(
      'Delete room?',
      `"${room.subject}" will be removed for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteRoom(room.id);
            res.ok ? hSuccess() : hError();
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={visible}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 100 }}
        refreshing={loading}
        onRefresh={refresh}
        ListHeaderComponent={
          <>
            <ScreenHeader
              title="Study Rooms"
              subtitle={visible.length
                ? `${visible.length} room${visible.length === 1 ? '' : 's'} · join one or host your own`
                : 'Host a session or join your classmates.'
              }
              serif
            />

            {/* Create Room CTA */}
            <View style={{ paddingHorizontal: space.xl, marginBottom: space.lg }}>
              <Pressable onPress={() => { thump(); router.push('/rooms/new'); }}>
                <LinearGradient
                  colors={['#7c3aed', '#a78bfa', '#c4b5fd']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.createCard}
                >
                  <View style={styles.createIcon}>
                    <Ionicons name="add" size={28} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.createTitle}>Host a study room</Text>
                    <Text style={styles.createSub}>Pick a subject, time + place — classmates can join with one tap.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.85)" />
                </LinearGradient>
              </Pressable>
            </View>

            {/* Filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.sm, marginBottom: space.lg }}
            >
              {FILTERS.map(f => {
                const sel = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => { tap(); setFilter(f.key); }}
                    style={({ pressed }) => [
                      styles.filterChip,
                      {
                        backgroundColor: sel ? c.accent : c.bgElevated,
                        borderColor: sel ? c.accent : c.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons name={f.icon} size={14} color={sel ? '#0a0a0a' : c.textMuted} />
                    <Text style={[
                      styles.filterText,
                      { color: sel ? '#0a0a0a' : c.text, fontWeight: sel ? font.weights.bold : font.weights.medium },
                    ]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {loading && rooms.length === 0 && (
              <ActivityIndicator color={c.textMuted} style={{ marginBottom: space.lg }} />
            )}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyEmoji]}>📚</Text>
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                {filter === 'all' ? 'No rooms yet' : 'No rooms match this filter'}
              </Text>
              <Text style={[styles.emptySub, { color: c.textMuted }]}>
                {filter === 'all'
                  ? 'Be the first to host a study session for your classmates.'
                  : 'Try "All" to see every upcoming room.'}
              </Text>
              {filter === 'all' && (
                <Pressable
                  onPress={() => { thump(); router.push('/rooms/new'); }}
                  style={({ pressed }) => [
                    styles.emptyBtn,
                    { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Ionicons name="add" size={18} color="#0a0a0a" />
                  <Text style={styles.emptyBtnText}>Create the first room</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item, index }) => (
          <RoomCard
            room={item}
            onJoin={onJoin}
            onLongPress={onLongPress}
            entranceIndex={index}
          />
        )}
        style={{ paddingHorizontal: space.xl }}
      />
    </View>
  );
}

function RoomCard({
  room,
  onJoin,
  onLongPress,
  entranceIndex,
}: {
  room: RoomFeedItem;
  onJoin: (r: RoomFeedItem) => void;
  onLongPress: (r: RoomFeedItem) => void;
  entranceIndex: number;
}) {
  const { c } = useTheme();
  const sc = useRef(new Animated.Value(1)).current;
  const op = useRef(new Animated.Value(0)).current;
  const tx = useRef(new Animated.Value(10)).current;

  // Entrance
  useMemoOnce(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 280, delay: entranceIndex * 50, useNativeDriver: true }),
      Animated.spring(tx, { toValue: 0, delay: entranceIndex * 50, useNativeDriver: true, speed: 14, bounciness: 6 }),
    ]).start();
  });

  const typeKey = (room.type === 'in_person' ? 'in_person' : 'online') as keyof typeof TYPE_COLOR;
  const accent = TYPE_COLOR[typeKey];
  const spotsLeft = room.spots - room.filled;
  const full = spotsLeft <= 0;

  // Match % vs the room's host — only shown when the viewer has
  // taken the quiz AND the host isn't the viewer themselves. This
  // mirrors the website's "you ↔ host" compatibility surfacing.
  const { scoreFor } = useMatchScores();
  const hostMatch = room.host ? scoreFor(room.host) : null;

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateY: tx }, { scale: sc }] }}>
      <Pressable
        onPressIn={() => Animated.spring(sc, { toValue: 0.98, useNativeDriver: true, speed: 60, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start()}
        onLongPress={() => onLongPress(room)}
        delayLongPress={500}
      >
        <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          {/* Accent stripe + type badge */}
          <View style={styles.cardHeader}>
            <View style={[styles.typePill, { backgroundColor: accent.bg, borderColor: accent.border }]}>
              <Ionicons
                name={typeKey === 'online' ? 'videocam' : 'people'}
                size={12}
                color={accent.fg}
              />
              <Text style={[styles.typePillText, { color: accent.fg }]}>
                {typeKey === 'online' ? 'Online' : 'In Person'}
              </Text>
            </View>
            <Text style={[styles.whenText, { color: c.textMuted }]}>
              {whenText(room.date, room.time)}
            </Text>
          </View>

          <Text style={[styles.subject, { color: c.text }]} numberOfLines={2}>
            {room.subject || 'Untitled session'}
          </Text>

          {/* Meta row */}
          <View style={styles.metaRow}>
            {room.location ? (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={14} color={c.textMuted} />
                <Text style={[styles.metaText, { color: c.textMuted }]} numberOfLines={1}>{room.location}</Text>
              </View>
            ) : null}
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={14} color={full ? '#ff8c00' : c.textMuted} />
              <Text style={[styles.metaText, { color: full ? '#ff8c00' : c.textMuted }]}>
                {room.filled}/{room.spots} {full ? '· FULL' : 'spots'}
              </Text>
            </View>
          </View>

          {/* Host row + Join button */}
          <View style={styles.bottomRow}>
            {room.host ? (
              <View style={styles.hostRow}>
                <Avatar
                  emoji={room.host.avatar_emoji}
                  color={room.host.avatar_color}
                  photoUrl={room.host.photo_url}
                  name={room.host.name}
                  size={26}
                />
                <Text style={[styles.hostName, { color: c.textMuted }]} numberOfLines={1}>
                  by {room.host.name ?? 'Anonymous'}
                </Text>
                {hostMatch ? (
                  <View style={[styles.matchPill, { backgroundColor: c.accentSoft }]}>
                    <Ionicons name="flag" size={10} color={c.accent} />
                    <Text style={[styles.matchPillText, { color: c.accent }]}>
                      {hostMatch.score}%
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : <View style={{ flex: 1 }} />}

            <Pressable
              onPress={() => onJoin(room)}
              disabled={full && !room.joined}
              style={({ pressed }) => [
                styles.joinBtn,
                {
                  backgroundColor: room.joined ? c.bgElevated : accent.fg,
                  borderColor: room.joined ? c.borderStrong : accent.fg,
                  opacity: (full && !room.joined) ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.joinText, { color: room.joined ? c.text : '#0a0a0a' }]}>
                {room.joined ? 'Leave' : full ? 'Full' : 'Join'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Fire a function once on mount — replacement for useEffect(() => {…}, []). */
function useMemoOnce(fn: () => void) {
  const fired = useRef(false);
  if (!fired.current) {
    fired.current = true;
    fn();
  }
}

const styles = StyleSheet.create({
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
  },
  createIcon: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  createTitle: { color: '#fff', fontSize: font.sizes.lg, fontWeight: font.weights.bold, marginBottom: 2 },
  createSub: { color: 'rgba(255,255,255,0.88)', fontSize: font.sizes.sm, lineHeight: 18 },

  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterText: { fontSize: font.sizes.sm },

  emptyWrap: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.xl, gap: space.sm },
  emptyEmoji: { fontSize: 56, marginBottom: space.sm },
  emptyTitle: { fontSize: font.sizes.xl, fontWeight: font.weights.bold },
  emptySub: { fontSize: font.sizes.md, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.pill, marginTop: space.md,
  },
  emptyBtnText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: '#0a0a0a' },

  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.sm, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1,
  },
  typePillText: { fontSize: 10, fontWeight: font.weights.bold, letterSpacing: 0.5 },
  whenText: { fontSize: font.sizes.sm, fontWeight: font.weights.medium },

  subject: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, letterSpacing: -0.2 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: font.sizes.sm },

  bottomRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: space.sm, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)',
    gap: space.md,
  },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  hostName: { fontSize: font.sizes.sm, flexShrink: 1 },
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  matchPillText: {
    fontSize: 11,
    fontWeight: font.weights.bold,
    letterSpacing: 0.1,
  },
  joinBtn: {
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.pill, borderWidth: 1,
  },
  joinText: { fontSize: font.sizes.sm, fontWeight: font.weights.bold, letterSpacing: 0.2 },
});
