/**
 * MagicMomentCard — one-time post-onboarding "wow" moment on Home.
 *
 * Mirrors `src/features/home/MagicMomentCard.tsx` on the website:
 *   "<Name>, let's build your first plan together.
 *    Paste a syllabus, share an exam date, or describe what's on your
 *    plate this week — Tony will build you a personalized study plan."
 *
 * Two states:
 *   1. Collapsed — Sparkles icon + heading + body + [Build my plan]
 *      (purple #5B4BF5) and [Skip for now] (ghost). Tapping the
 *      purple button opens the textarea.
 *   2. Expanded — multiline TextInput + [Generate plan with Tony]
 *      submit + Back / Skip forever.
 *
 * Submit handler routes to /(tabs)/ai with a localStorage-backed
 * prefill flag so the AI screen can pick it up. (Mobile uses
 * AsyncStorage instead of localStorage — same role.)
 *
 * Dismiss is sticky via AsyncStorage `bu:magic-moment-dismissed`,
 * mirroring the same key the web uses so users who saw it on the web
 * don't see it again on the phone.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tap, thump } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

const DISMISS_KEY = 'bu:magic-moment-dismissed';
/** Same key the AI screen reads on mount to pre-fill the composer. */
export const MAGIC_PREFILL_KEY = 'bu:magic-moment-prefill';

const TONY_PURPLE = '#5B4BF5';

export function MagicMomentCard({ firstName }: { firstName?: string }) {
  const { c, mode } = useTheme();
  const router = useRouter();
  // null while AsyncStorage is loading so we don't flash the card and
  // then yank it away on hydrate.
  const [visible, setVisible] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY)
      .then(v => setVisible(!v))
      .catch(() => setVisible(false));
  }, []);

  if (!visible) return null;

  const dismiss = async () => {
    tap();
    setVisible(false);
    try { await AsyncStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* fail open */ }
  };

  const submit = async () => {
    const raw = text.trim();
    if (!raw) return;
    thump();
    const prefill = [
      "Build me a personalized study plan based on what I'm sharing below.",
      "If you don't have all the info you need (exam date, subjects, hours per day), ask me ONE short question to fill the gap before generating.",
      '',
      "Here's what I have:",
      raw,
    ].join('\n');
    try {
      await AsyncStorage.setItem(MAGIC_PREFILL_KEY, prefill);
      await AsyncStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch { /* fail open */ }
    setVisible(false);
    router.push('/(tabs)/ai');
  };

  const greet = firstName ? `${firstName}, ` : '';

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: TONY_PURPLE + '55',
          backgroundColor: mode === 'dark' ? '#10101a' : '#fbfaff',
        },
      ]}
    >
      <Pressable
        onPress={dismiss}
        hitSlop={8}
        style={styles.dismissBtn}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Ionicons name="close" size={14} color={c.textMuted} />
      </Pressable>

      <View style={styles.headerRow}>
        <View style={[styles.iconCircle, { backgroundColor: TONY_PURPLE + '22' }]}>
          <Ionicons name="sparkles" size={18} color={TONY_PURPLE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]}>
            {greet}let&apos;s build your first plan together.
          </Text>
          <Text style={[styles.body, { color: c.textMuted }]}>
            Paste a syllabus, share an exam date, or describe what&apos;s on your
            plate this week — Tony will build you a personalized study plan.
          </Text>
        </View>
      </View>

      {!expanded ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => { tap(); setExpanded(true); }}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: TONY_PURPLE, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Build my plan</Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.ghostBtnText, { color: c.textMuted }]}>Skip for now</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="e.g. Calc II midterm May 20 — chapters 4-7. I have 3 hours/day for the next 5 days."
            placeholderTextColor={c.textFaint}
            style={[
              styles.textarea,
              { color: c.text, backgroundColor: c.bg, borderColor: c.border },
            ]}
          />
          <View style={styles.actionsRow}>
            <Pressable
              onPress={submit}
              disabled={!text.trim()}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: TONY_PURPLE,
                  opacity: pressed ? 0.85 : text.trim() ? 1 : 0.4,
                },
              ]}
            >
              <Text style={styles.primaryBtnText}>Generate plan with Tony</Text>
            </Pressable>
            <Pressable
              onPress={() => { tap(); setExpanded(false); setText(''); }}
              style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.ghostBtnText, { color: c.textMuted }]}>Back</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    position: 'relative',
  },
  dismissBtn: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    paddingRight: space.lg, // leave room for the close button
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  body: {
    marginTop: 6,
    fontSize: 13.5,
    lineHeight: 19,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
    alignItems: 'center',
  },
  primaryBtn: {
    height: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  ghostBtn: {
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  textarea: {
    minHeight: 96,
    maxHeight: 200,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.sizes.md,
    lineHeight: 21,
    textAlignVertical: 'top',
  },

  // Provided through font for completeness — referenced by other styles.
});
