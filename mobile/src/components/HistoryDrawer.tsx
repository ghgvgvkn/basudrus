/**
 * HistoryDrawer — slide-in panel showing the student's past chats and
 * saved study plans, plus a quick entry into the Memory view. Mobile
 * twin of `src/features/ai/HistorySidebar.tsx` on the web — roughly
 * mirrors ChatGPT's left sidebar but with Bas Udrus styling and the
 * Memory section moved to a deliberate, prominent spot (it's our
 * differentiator vs ChatGPT).
 *
 * Layout, top to bottom:
 *   1. Profile header — avatar, name, uni · major · year
 *   2. Memory shortcut card — "N things the AI remembers · View"
 *   3. Chats — grouped by Today / Yesterday / Last 7 / Earlier
 *   4. Plans — flat list, newest first
 *
 * Mobile behaviour:
 *   - Renders inside a transparent React Native <Modal>. The drawer
 *     itself is an animated <Animated.View> that slides in from the
 *     left, 85% of viewport width (max 360pt). The remaining 15%
 *     shows a dim backdrop that closes the drawer when tapped.
 *   - Tapping a chat row calls `onSelectSession(item)` so the AI tab
 *     can load that chat back into the composer (switching persona
 *     if needed).
 *   - The Memory shortcut opens MemoryModal in place.
 *
 * Why a custom drawer instead of a navigation-stack route:
 *   The web's HistorySidebar overlays the chat area without unmounting
 *   it. Replicating that as a route would tear down the AI tab's chat
 *   state every open/close. A Modal overlay keeps the chat untouched.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { tap, thump } from '@/lib/haptics';
import { useAIHistory, type SessionListItem, type StudyPlanListItem } from '@/hooks/useAIHistory';
import { useStudentMemory } from '@/hooks/useStudentMemory';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 360);

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user taps a past chat row. The AI tab decides
   *  whether to resume the chat (load messages + switch persona). */
  onSelectSession: (item: SessionListItem) => void;
  /** Called when the user taps a saved study plan. */
  onSelectPlan?: (item: StudyPlanListItem) => void;
  /** Called when the user taps the Memory shortcut card. The AI tab
   *  is responsible for rendering MemoryModal as a sibling of this
   *  drawer — nesting Modals inside Modals can mis-animate on Android
   *  and is harder to dismiss correctly, so we lift the modal up. */
  onOpenMemory: () => void;
  /** Profile bits for the header — name + uni/major/year. */
  profile: {
    name?: string | null;
    uni?: string | null;
    major?: string | null;
    year?: string | null;
  } | null;
  /** Monotonically increasing tick the AI tab bumps after a chat row
   *  is created or updated server-side. When this changes, the drawer
   *  re-runs `useAIHistory.refresh()` so the new session appears under
   *  "Today" without the user having to close-and-reopen the drawer.
   *  Optional — drawer falls back to its own mount-fetch when omitted. */
  refreshSignal?: number;
}

export function HistoryDrawer({
  open,
  onClose,
  onSelectSession,
  onSelectPlan,
  onOpenMemory,
  profile,
  refreshSignal,
}: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const slideX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const { sessionsGrouped, plans, deleteSession, deletePlan, loading, refresh } = useAIHistory();
  const { memories } = useStudentMemory();

  // Refresh on three triggers so the drawer is never stale:
  //   1. `open` flips true — reopening should always show the latest
  //      chats even if the user persisted a turn while it was closed.
  //   2. `refreshSignal` bump — the AI tab uses this to nudge us right
  //      after a row is inserted/updated, so the new session pops in
  //      under "Today" instantly (no pull-to-refresh required).
  //   3. Initial mount fetch is already handled by useAIHistory itself.
  // Effect deliberately ignores `refresh` identity churn — the hook
  // memoises it on userId, so the dep array stays narrow.
  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshSignal]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: open ? 0 : -DRAWER_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, slideX, backdropOpacity]);

  const totalSessions =
    sessionsGrouped.today.length +
    sessionsGrouped.yesterday.length +
    sessionsGrouped.lastSeven.length +
    sessionsGrouped.earlier.length;

  return (
    <Modal
      visible={open}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      {/* Backdrop: tap-to-close, slightly tinted. Sits below the drawer. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.35)', opacity: backdropOpacity },
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Drawer */}
      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            backgroundColor: c.bg,
            borderRightColor: c.border,
            transform: [{ translateX: slideX }],
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {/* Header */}
        <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
          <ProfileBlock profile={profile} />
          <Pressable
            onPress={() => {
              tap();
              onClose();
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerIconBtn,
              { opacity: pressed ? 0.55 : 1 },
            ]}
            accessibilityLabel="Close history"
          >
            <Ionicons name="close" size={20} color={c.text} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          {/* Memory shortcut card — the headline differentiator vs
              ChatGPT. Shows the current memory count or a teach-CTA.
              We close the drawer first so MemoryModal animates onto a
              clean stage; the parent re-opens it via onOpenMemory. */}
          <Pressable
            onPress={() => {
              tap();
              onClose();
              // Small delay so the drawer close animation finishes
              // before MemoryModal slides in — overlapping the two
              // looks jittery on lower-end Android.
              setTimeout(onOpenMemory, 240);
            }}
            style={({ pressed }) => [
              styles.memoryCard,
              {
                backgroundColor: c.bgElevated,
                borderColor: c.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.memoryIcon, { backgroundColor: '#5B4BF522' }]}>
              <MaterialCommunityIcons name="brain" size={16} color="#5B4BF5" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.memoryTitle, { color: c.text }]} numberOfLines={1}>
                {memories.length === 0
                  ? 'Teach your AI about you'
                  : `${memories.length} thing${memories.length === 1 ? '' : 's'} the AI remembers`}
              </Text>
              <Text style={[styles.memorySub, { color: c.textMuted }]} numberOfLines={1}>
                {memories.length === 0
                  ? 'Add or import facts you want them to know'
                  : 'View, edit, add new, or import more'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
          </Pressable>

          {/* Chats */}
          <SectionHeader icon="chatbubble-outline" label="Chats" />
          {loading && totalSessions === 0 ? (
            <ActivityIndicator color={c.textMuted} style={{ margin: space.lg }} />
          ) : null}

          <DateGroup
            label="Today"
            items={sessionsGrouped.today}
            onSelect={item => {
              onSelectSession(item);
              onClose();
            }}
            onDelete={deleteSession}
          />
          <DateGroup
            label="Yesterday"
            items={sessionsGrouped.yesterday}
            onSelect={item => {
              onSelectSession(item);
              onClose();
            }}
            onDelete={deleteSession}
          />
          <DateGroup
            label="Last 7 days"
            items={sessionsGrouped.lastSeven}
            onSelect={item => {
              onSelectSession(item);
              onClose();
            }}
            onDelete={deleteSession}
          />
          <DateGroup
            label="Earlier"
            items={sessionsGrouped.earlier}
            onSelect={item => {
              onSelectSession(item);
              onClose();
            }}
            onDelete={deleteSession}
          />

          {!loading && totalSessions === 0 ? (
            <EmptyHint
              icon="sparkles-outline"
              text="No chats yet. Start one in the main area."
            />
          ) : null}

          {/* Plans */}
          <SectionHeader icon="document-text-outline" label="Plans" />
          {plans.length === 0 ? (
            <EmptyHint
              icon="sparkles-outline"
              text="Plans you create with Tony Starrk will show up here."
            />
          ) : null}
          {plans.map(p => (
            <PlanRow
              key={p.id}
              item={p}
              onSelect={item => {
                if (onSelectPlan) {
                  onSelectPlan(item);
                  onClose();
                }
              }}
              onDelete={deletePlan}
            />
          ))}
        </ScrollView>
      </Animated.View>

    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function ProfileBlock({
  profile,
}: {
  profile: Props['profile'];
}) {
  const { c } = useTheme();
  const initial = (profile?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const yearLabel =
    profile?.year != null && profile.year !== '' ? `Year ${profile.year}` : null;
  const meta = [profile?.uni, profile?.major, yearLabel].filter(Boolean).join(' · ');
  return (
    <View style={styles.profileBlock}>
      <View style={[styles.profileAvatar, { backgroundColor: c.text }]}>
        <Text style={[styles.profileInitial, { color: c.bg }]}>{initial}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
          {profile?.name || 'You'}
        </Text>
        <Text style={[styles.profileMeta, { color: c.textMuted }]} numberOfLines={1}>
          {meta || 'Profile incomplete'}
        </Text>
      </View>
    </View>
  );
}

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={11} color={c.textMuted} />
      <Text style={[styles.sectionLabel, { color: c.textMuted }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function DateGroup({
  label,
  items,
  onSelect,
  onDelete,
}: {
  label: string;
  items: SessionListItem[];
  onSelect: (item: SessionListItem) => void;
  onDelete: (id: string, persona: SessionListItem['persona']) => Promise<boolean>;
}) {
  const { c } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={[styles.dateLabel, { color: c.textFaint }]}>{label.toUpperCase()}</Text>
      <View style={{ gap: 2 }}>
        {items.map(item => (
          <SessionRow
            key={`${item.persona}-${item.id}`}
            item={item}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </View>
    </View>
  );
}

function SessionRow({
  item,
  onSelect,
  onDelete,
}: {
  item: SessionListItem;
  onSelect: (item: SessionListItem) => void;
  onDelete: (id: string, persona: SessionListItem['persona']) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const isSherlock = item.persona === 'noor';
  // Tony Starrk → blue-violet brain. Sherlock → rose heart.
  const accent = isSherlock ? '#C23F6C' : '#5B4BF5';
  const title = item.title || 'Untitled chat';

  return (
    <View style={styles.sessionRowOuter}>
      <Pressable
        onPress={() => {
          tap();
          onSelect(item);
        }}
        style={({ pressed }) => [
          styles.sessionRow,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.personaBadge, { backgroundColor: `${accent}14` }]}>
          {isSherlock ? (
            <Ionicons name="heart" size={10} color={accent} />
          ) : (
            <MaterialCommunityIcons name="brain" size={10} color={accent} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <Text
            style={[styles.sessionTitle, { color: c.text }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Text style={[styles.sessionMeta, { color: c.textFaint }]} numberOfLines={1}>
            {(isSherlock ? 'Sherlock' : item.subject) || '—'}
            {item.message_count > 0 ? ` · ${item.message_count} msg${item.message_count === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
      </Pressable>

      {confirming ? (
        <View style={styles.sessionTrailing}>
          <Pressable
            onPress={async () => {
              thump();
              await onDelete(item.id, item.persona);
            }}
            style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.deleteBtnText}>Delete</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              setConfirming(false);
            }}
            style={({ pressed }) => [
              styles.cancelBtn,
              { backgroundColor: c.bgElevated, borderColor: c.border, opacity: pressed ? 0.55 : 1 },
            ]}
          >
            <Ionicons name="close" size={11} color={c.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            tap();
            setConfirming(true);
          }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.trashBtn,
            { opacity: pressed ? 0.55 : 0.5 },
          ]}
          accessibilityLabel="Delete chat"
        >
          <Ionicons name="trash-outline" size={13} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function PlanRow({
  item,
  onSelect,
  onDelete,
}: {
  item: StudyPlanListItem;
  onSelect: (item: StudyPlanListItem) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const subjectsBlurb = item.subjects?.slice(0, 2).join(', ') ?? '';
  return (
    <View style={styles.sessionRowOuter}>
      <Pressable
        onPress={() => {
          tap();
          onSelect(item);
        }}
        style={({ pressed }) => [
          styles.sessionRow,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <Text
            style={[styles.sessionTitle, { color: c.text }]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <Text style={[styles.sessionMeta, { color: c.textFaint }]} numberOfLines={1}>
            {subjectsBlurb}
            {subjectsBlurb && item.exam_date ? ' · ' : ''}
            {item.exam_date ? `exam ${item.exam_date}` : ''}
          </Text>
        </View>
      </Pressable>
      {confirming ? (
        <View style={styles.sessionTrailing}>
          <Pressable
            onPress={async () => {
              thump();
              await onDelete(item.id);
            }}
            style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.deleteBtnText}>Delete</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              setConfirming(false);
            }}
            style={({ pressed }) => [
              styles.cancelBtn,
              { backgroundColor: c.bgElevated, borderColor: c.border, opacity: pressed ? 0.55 : 1 },
            ]}
          >
            <Ionicons name="close" size={11} color={c.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            tap();
            setConfirming(true);
          }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.trashBtn,
            { opacity: pressed ? 0.55 : 0.5 },
          ]}
          accessibilityLabel="Delete plan"
        >
          <Ionicons name="trash-outline" size={13} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function EmptyHint({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.emptyHint,
        { backgroundColor: c.bgElevated, borderColor: c.border },
      ]}
    >
      <Ionicons name={icon} size={11} color={c.textFaint} />
      <Text style={[styles.emptyHintText, { color: c.textMuted }]}>{text}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Profile block
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    minWidth: 0,
  },
  profileAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontSize: 14,
    fontWeight: '800',
  },
  profileName: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  profileMeta: {
    fontSize: 11,
    marginTop: 1,
  },

  // Scroll body
  scrollBody: {
    paddingHorizontal: space.sm,
    paddingTop: space.md,
    paddingBottom: space.xxl,
  },

  // Memory card
  memoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  memoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  memorySub: {
    fontSize: 11.5,
    marginTop: 2,
  },

  // Section header (e.g. CHATS, PLANS)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    marginTop: space.lg,
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Date label
  dateLabel: {
    paddingHorizontal: space.sm,
    marginBottom: 4,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Session / Plan row
  sessionRowOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  sessionRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: 8,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  personaBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sessionTitle: {
    fontSize: 13,
    lineHeight: 17,
  },
  sessionMeta: {
    fontSize: 10.5,
    marginTop: 2,
  },
  trashBtn: {
    position: 'absolute',
    right: 4,
    top: '50%',
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionTrailing: {
    position: 'absolute',
    right: 4,
    top: '50%',
    marginTop: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deleteBtn: {
    backgroundColor: '#C23F6C',
    paddingHorizontal: 8,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: '700',
  },
  cancelBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty hint
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    marginHorizontal: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  emptyHintText: {
    flex: 1,
    fontSize: font.sizes.sm,
    lineHeight: 17,
  },
});
