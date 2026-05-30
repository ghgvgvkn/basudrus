/**
 * Chat screen — real-time DM between two users.
 *
 * v3 changes:
 *   - Keyboard handling matches the AI tab's pattern:
 *     • `keyboardVerticalOffset={0}` (KAV bottom IS the screen bottom
 *       on a pushed Stack screen — the old `insets.bottom + 60` value
 *       left a huge gap between the composer and the keyboard top).
 *     • FlatList gets `style={{ flex: 1 }}` so it actually fills the
 *       shrinking KAV instead of collapsing when there are no msgs.
 *     • Composer's `paddingBottom` is dynamic: home-indicator inset
 *       when the keyboard is down, slim when it's up (the indicator
 *       is hidden behind the keyboard anyway).
 *     • Composer's padding transitions are run through
 *       `LayoutAnimation.configureNext` with the keyboard's OWN
 *       duration / easing so the composer rides up smoothly in
 *       lock-step with the keyboard instead of snapping.
 *
 * v2 changes:
 *   - Photo + Voice attach buttons in the composer (Pro-gated; non-Pro
 *     users get routed to /upgrade when they tap them). The actual
 *     image-picker + audio recorder integration ships in a follow-up
 *     once we add the native deps.
 *   - Composer styling matches Tony chat for consistency.
 *   - Better bubble rendering: shows image / voice bubbles for any
 *     existing messages whose `message_type` is "image" or "voice" so
 *     when the picker DOES ship, this screen already renders them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useGameTracking } from '@/hooks/useGameTracking';
import { thump, tap, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import type { Message } from '@/lib/supabase';

// Mirrors ai.tsx — opt the old Android arch into LayoutAnimation so the
// composer's padding transition stays smooth on Android too. No-op on
// iOS / new arch.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function ChatScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const { messages, loading, myId, sendMessage } = useMessages(partnerId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [partnerName, setPartnerName] = useState('Chat');
  const [isPro, setIsPro] = useState(false);
  // Track keyboard up/down so the composer can drop the safe-area
  // bottom padding (which is hidden under the keyboard anyway) and
  // glue itself to the keyboard top.
  const [kbVisible, setKbVisible] = useState(false);
  const listRef = useRef<FlatList>(null);
  const { awardXP } = useGameTracking();

  useEffect(() => {
    // iOS exposes `keyboardWillShow/Hide` BEFORE the slide animation
    // runs — perfect for chaining LayoutAnimation. Android only fires
    // `Did`, so the layout pass happens just after the keyboard
    // settles, still smoothed by configureNext.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onChange = (next: boolean) => (e: KeyboardEvent) => {
      // Drive the composer's padding shrink/grow on the keyboard's
      // OWN timing curve. Without this the composer popped while the
      // keyboard slid — visible jitter on iOS.
      LayoutAnimation.configureNext({
        duration: e?.duration || 250,
        update: { type: 'keyboard' },
      });
      setKbVisible(next);
    };
    const show = Keyboard.addListener(showEvt, onChange(true));
    const hide = Keyboard.addListener(hideEvt, onChange(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    supabase.from('profiles').select('name').eq('id', partnerId).maybeSingle().then(({ data }) => {
      if (data?.name) setPartnerName(data.name);
    });
  }, [partnerId]);

  useEffect(() => {
    let cancelled = false;
    const uid = session?.user?.id;
    if (!uid) return;
    supabase
      .from('profiles')
      .select('pro')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsPro((data as { pro?: boolean } | null)?.pro === true);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    thump();
    setInput('');
    setSending(true);
    // Drop the keyboard after send so the freshly-sent message is
    // visible. Mirrors Claude / ChatGPT / Instagram DMs — the
    // keyboard slides down on the OS curve thanks to the
    // LayoutAnimation we wired up on keyboardWillHide, so this
    // looks like a single fluid gesture.
    Keyboard.dismiss();
    try {
      await sendMessage(text);
      // +2 XP for an outgoing DM. Small reward keeps the streak alive
      // without making spam feel rewarding.
      void awardXP(2);
    } catch {
      hError();
    } finally {
      setSending(false);
    }
  };

  const requirePro = useCallback((_kind: 'photo' | 'voice') => {
    tap();
    if (isPro) {
      // Pro features land in the next release — picker + recorder.
      hError();
      return;
    }
    router.push('/upgrade');
  }, [isPro, router]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Offset = 0. This is a pushed Stack screen (not a tab), so the
      // KAV's bottom edge sits at the screen bottom. The old
      // `insets.bottom + 60` value over-corrected the keyboard height
      // and left a huge empty band between the composer and the
      // keyboard top — same bug we just fixed on the AI tab.
      keyboardVerticalOffset={0}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: partnerName,
          headerStyle: { backgroundColor: c.bg },
          headerTitleStyle: { color: c.text, fontWeight: '600' },
          headerTintColor: c.accent,
          headerBackTitle: 'Connect',
        }}
      />

      {loading ? (
        <ActivityIndicator color={c.textMuted} style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          // flex:1 keeps the list filling the KAV so the composer
          // stays pinned to the bottom even when messages is empty.
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            padding: space.lg,
            paddingBottom: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textMuted }]}>
              Say hello to start the conversation!
            </Text>
          }
          renderItem={({ item }) => <Bubble msg={item} myId={myId} />}
        />
      )}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: c.bgElevated,
            borderTopColor: c.border,
            // Same logic as the AI composer:
            //   • Keyboard down → reserve home-indicator safe area.
            //   • Keyboard up   → indicator is hidden under the
            //     keyboard, drop the reserve so the input glues to
            //     the keyboard top instead of floating above it.
            // The kbVisible flip is wrapped in LayoutAnimation, so
            // the transition runs on the keyboard's own curve.
            paddingBottom: kbVisible ? space.sm : insets.bottom + space.sm,
          },
        ]}
      >
        <View style={styles.composerRow}>
          {/* Photo */}
          <Pressable
            onPress={() => requirePro('photo')}
            style={({ pressed }) => [
              styles.attachBtn,
              { backgroundColor: c.bg, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="image-outline" size={20} color="#a78bfa" />
            {!isPro && <View style={[styles.proDot, { backgroundColor: '#ffb800' }]} />}
          </Pressable>

          {/* Voice */}
          <Pressable
            onPress={() => requirePro('voice')}
            style={({ pressed }) => [
              styles.attachBtn,
              { backgroundColor: c.bg, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="mic-outline" size={20} color="#39d27a" />
            {!isPro && <View style={[styles.proDot, { backgroundColor: '#ffb800' }]} />}
          </Pressable>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message…"
            placeholderTextColor={c.textFaint}
            multiline
            style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
          />
          <Pressable
            onPress={send}
            disabled={!input.trim() || sending}
            style={[
              styles.sendBtn,
              {
                backgroundColor: input.trim() && !sending ? c.accent : c.bgCard,
                opacity: input.trim() && !sending ? 1 : 0.5,
              },
            ]}
          >
            <Ionicons name="arrow-up" size={20} color={input.trim() && !sending ? '#000' : c.textMuted} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ msg, myId }: { msg: Message; myId: string | null }) {
  const { c, mode } = useTheme();
  const mine = msg.sender_id === myId;
  const kind = msg.message_type;

  // Both sent + received bubbles get a visible border so messages
  // read as distinct shapes against the background — per the user
  // ask for "message bubbles with visible borders/boundaries".
  // Mine: subtle darker rim against the accent fill.
  // Theirs: standard card border.
  const bubbleBg = mine ? c.accent : c.bgCard;
  const bubbleBorder = mine
    ? (mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.18)')
    : c.border;
  const fg = mine ? '#000' : c.text;

  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleBg,
            borderWidth: 1,
            borderColor: bubbleBorder,
          },
        ]}
      >
        {kind === 'voice' ? (
          <View style={styles.mediaRow}>
            <Ionicons name="mic" size={18} color={fg} />
            <Text style={{ color: fg, fontSize: font.sizes.md }}>
              Voice message
            </Text>
          </View>
        ) : kind === 'image' ? (
          <View style={styles.mediaRow}>
            <Ionicons name="image" size={18} color={fg} />
            <Text style={{ color: fg, fontSize: font.sizes.md }}>
              Photo
            </Text>
          </View>
        ) : (
          <Text style={{ color: fg, fontSize: font.sizes.md, lineHeight: 21 }}>
            {msg.text}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', paddingVertical: space.xxl, fontSize: font.sizes.md },

  bubbleWrap: { marginBottom: space.sm },
  bubbleLeft: { alignItems: 'flex-start' },
  bubbleRight: { alignItems: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  composer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: font.sizes.md,
  },
  attachBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    position: 'relative',
  },
  proDot: {
    position: 'absolute',
    top: 6, right: 6,
    width: 8, height: 8, borderRadius: 4,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
