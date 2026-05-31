/**
 * Connect — DM threads (chat history).
 *
 * v4 changes (user feedback: "Can you put in the messages like to each
 * person iMessage just outline or an edge to make it more professional?"):
 *   - Each conversation row is now an OUTLINED CARD instead of a flat
 *     row with a hairline divider. Same content + layout, but wrapped
 *     in a 1pt-border rounded container with breathing room between
 *     cards — reads more like iMessage / iOS Mail's card list and
 *     immediately telegraphs "this is a tappable conversation".
 *   - The list itself gets horizontal padding so the cards inset
 *     from the screen edges. The bottom-border divider style is gone.
 *
 * v3: Removed Mental Health pane (moved to AI tab). Connect = messages.
 * v2: SegmentedControl flipped between Messages / Mental Health.
 *
 * Per-row match badge — each conversation shows the personality +
 * profile compatibility percentage with that partner so the chat list
 * reads more like the web's Messages page where every conversation
 * has a "% match" beside the name.
 */
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useConversations, type ConversationRow } from '@/hooks/useConversations';
import { useMatchScores } from '@/hooks/useMatchScores';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ConnectScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { conversations, loading, refresh } = useConversations();
  const { scoreFor } = useMatchScores();

  const openChat = (partnerId: string) => {
    tap();
    router.push(`/chat/${partnerId}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <ScreenHeader title="Messages" subtitle="Your study partner chats." serif />

      <FlatList
        data={conversations}
        keyExtractor={item => item.partner_id}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + 100,
        }}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.bgElevated }]}>
                <Ionicons name="chatbubbles-outline" size={28} color={c.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No conversations yet</Text>
              <Text style={[styles.emptySub, { color: c.textMuted }]}>
                Go to Discover and tap &quot;Say Hi&quot; to start a chat with a
                classmate.
              </Text>
            </View>
          ) : (
            <ActivityIndicator color={c.textMuted} style={{ margin: space.xxl }} />
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => openChat(item.partner_id)}
            activeOpacity={0.85}
            style={[
              styles.threadCard,
              { backgroundColor: c.bgCard, borderColor: c.border },
            ]}
          >
            <ThreadRow item={item} match={scoreFor(item.partner)} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function ThreadRow({
  item,
  match,
}: {
  item: ConversationRow;
  match: { score: number } | null;
}) {
  const { c } = useTheme();
  const p = item.partner;
  const isRecent =
    !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 24 * 3600 * 1000;

  return (
    <View style={styles.threadInner}>
      <Avatar
        emoji={p.avatar_emoji}
        color={p.avatar_color}
        photoUrl={p.photo_url}
        name={p.name}
        size={48}
        online={p.online || isRecent}
      />
      <View style={styles.threadText}>
        <View style={styles.threadTop}>
          <Text style={[styles.threadName, { color: c.text }]} numberOfLines={1}>
            {p.name ?? 'Unknown'}
          </Text>
          {match ? (
            <View style={[styles.matchPill, { backgroundColor: c.accentSoft }]}>
              <Ionicons name="flag" size={10} color={c.accent} />
              <Text style={[styles.matchText, { color: c.accent }]}>{match.score}%</Text>
            </View>
          ) : null}
          <Text style={[styles.threadTime, { color: c.textFaint }]}>
            {timeAgo(item.last_message_at)}
          </Text>
        </View>
        <Text style={[styles.threadPreview, { color: c.textMuted }]} numberOfLines={1}>
          {item.last_message_preview
            ? (item.last_message_from_me ? 'You: ' : '') + item.last_message_preview
            : 'Tap to start chatting'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Each conversation is its own outlined card — see v4 note in
  // header. Thin 1pt border + 14pt corner radius gives the iMessage
  // / iOS Mail "tappable conversation tile" feel the user asked for.
  threadCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
  },
  threadInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    gap: space.md,
  },
  threadText: { flex: 1 },
  threadTop: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: space.sm,
  },
  threadName: {
    fontSize: font.sizes.lg,
    fontWeight: font.weights.semibold,
    flex: 1,
    marginRight: space.sm,
  },
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  matchText: { fontSize: 11, fontWeight: font.weights.bold, letterSpacing: 0.2 },
  threadTime: { fontSize: font.sizes.sm },
  threadPreview: { fontSize: font.sizes.md, marginTop: 2 },

  empty: { paddingHorizontal: space.xl, paddingTop: space.xxl, alignItems: 'center' },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
    marginBottom: space.md,
  },
  emptySub: { fontSize: font.sizes.md, textAlign: 'center', lineHeight: 22 },
});
