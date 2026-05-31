/**
 * AskTonyHomeHero — minimized port of the website's home-screen "Ask AI"
 * card (`src/features/home/HomeScreen.tsx`, the col-8 section that says
 * "Hello, <name>." + "Ask AI (Tony Starrk) anything …" + input +
 * suggestion chips).
 *
 * The website card uses `p-8` (32pt) padding and a 2-line subtitle. The
 * user asked for the same thing on mobile but "smaller — minimise the
 * box, not the sizes". So:
 *
 *   KEPT (same visual weight as the web card):
 *     • Italic-serif greeting "Hello, <name>." — same Georgia italic
 *       look the website uses for `serif text-2xl`.
 *     • The Sparkles glyph inside the input.
 *     • The 3 suggestion chips ("quiz me on DB joins", …) — same copy.
 *     • The dark "Ask →" submit button.
 *
 *   SHRUNK / DROPPED (the BOX, not the controls):
 *     • Card padding: 16pt instead of the web's 32pt.
 *     • Subtitle collapsed to ONE line ("Ask AI (Tony Starrk) anything.")
 *       instead of the web's 2-line version. Same role (tells the user
 *       this hero is the AI), just compact.
 *     • Input + button heights tightened to 44pt (vs web's 48pt) so the
 *       whole hero stays under ~190pt tall on a 375-wide phone — short
 *       enough that the duo row (Match / Past papers) is still above
 *       the fold.
 *
 * Submit behavior mirrors the existing MagicMomentCard flow:
 *   1. Write the trimmed input text to `MAGIC_PREFILL_KEY` in
 *      AsyncStorage.
 *   2. `router.push('/(tabs)/ai')` — the AI tab reads the same key on
 *      mount and pre-fills its composer with whatever we wrote.
 *
 * Tapping a suggestion chip does the same with the chip's text — same
 * code path, so the AI tab just sees "user wrote X" without caring
 * whether they typed it or tapped a chip. Haptic `tap` on chip /
 * `thump` on the primary Ask button matches the rest of the app.
 */
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Sparkles, ArrowRight } from 'lucide-react-native';
import { MAGIC_PREFILL_KEY } from '@/components/MagicMomentCard';
import { tap, thump } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

// Same purple Tony's surfaces use across the web + AI tab — kept here
// (instead of pulling from the theme accent) because the Sparkles glyph
// inside the input must read purple in BOTH light and dark mode, the
// way the website's `text-accent` does on the `:root` light token.
const TONY_PURPLE = '#5B4BF5';

const SUGGESTIONS = [
  'quiz me on DB joins',
  'plan my finals week',
  "who's a good algo partner?",
] as const;

export function AskTonyHomeHero({
  greet,
  firstName,
}: {
  /** Time-of-day greeting (e.g. "Good morning", "Hello"). Caller owns
   *  the choice so the rest of Home can stay in sync if it ever needs
   *  to render the same greeting elsewhere. */
  greet: string;
  /** First-name to address the user by. */
  firstName: string;
}) {
  const { c, mode } = useTheme();
  const dark = mode === 'dark';
  const router = useRouter();
  const [draft, setDraft] = useState('');

  // Hand off to /(tabs)/ai via the same AsyncStorage key the AI screen
  // already reads on mount (see ai.tsx — `AsyncStorage.getItem(MAGIC_PREFILL_KEY)`).
  // No new wiring required: the AI tab consumes the value, sets the
  // composer text, deletes the key. Identical UX whether the user got
  // here from MagicMomentCard, a chip, or the Ask button.
  const handoffToAI = async (text: string) => {
    const raw = text.trim();
    if (!raw) return;
    try {
      await AsyncStorage.setItem(MAGIC_PREFILL_KEY, raw);
    } catch {
      /* fail open — worst case the AI screen opens with an empty composer */
    }
    router.push('/(tabs)/ai');
  };

  const onAsk = () => {
    if (!draft.trim()) return;
    thump();
    void handoffToAI(draft);
  };

  const onChipPress = (text: string) => {
    tap();
    void handoffToAI(text);
  };

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
      {/* Greeting — italic serif, same Georgia italic the standalone
          greeting line used. Keeping it in this card now (instead of
          a separate line above) matches the website's hero layout. */}
      <Text style={[styles.greeting, { color: c.text }]} numberOfLines={1}>
        {greet}, {firstName}.
      </Text>

      {/* One-line subtitle — compressed from the website's 2-line copy
          ("Ask AI (Tony Starrk) anything — study help, exam stress,
          planning, who to study with."). Same intent, half the height. */}
      <Text style={[styles.subtitle, { color: c.textMuted }]} numberOfLines={1}>
        Ask AI (Tony Starrk) anything.
      </Text>

      {/* Input + Ask button row */}
      <View style={styles.inputRow}>
        <View
          style={[
            styles.inputPill,
            {
              backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              borderColor: c.border,
            },
          ]}
        >
          <Sparkles size={16} color={TONY_PURPLE} strokeWidth={2} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={onAsk}
            placeholder="e.g. help me study for midterms in 3 days"
            placeholderTextColor={c.textMuted}
            returnKeyType="send"
            style={[styles.input, { color: c.text }]}
          />
        </View>

        <Pressable
          onPress={onAsk}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            styles.askBtn,
            {
              backgroundColor: c.text,
              opacity: !draft.trim() ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Ask Tony"
        >
          <Text style={[styles.askBtnText, { color: c.bg }]}>Ask</Text>
          <ArrowRight size={14} color={c.bg} strokeWidth={2.5} />
        </Pressable>
      </View>

      {/* Suggestion chips — same 3 the website uses, in the same order */}
      <View style={styles.chipsRow}>
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => onChipPress(s)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                borderColor: c.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={s}
          >
            <Text style={[styles.chipText, { color: c.text }]} numberOfLines={1}>
              {s}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    // 16pt padding — half of the website's 32pt to "minimize the box"
    // without shrinking any of the controls inside.
    padding: space.lg,
    gap: space.sm,
  },

  greeting: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
  },
  subtitle: {
    fontSize: font.sizes.sm,
    lineHeight: 18,
    marginBottom: space.xs,
  },

  // ── input + Ask button ───────────────────────────────────────────
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: font.sizes.sm,
    paddingVertical: 0,
  },
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  askBtnText: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.semibold,
  },

  // ── chips ────────────────────────────────────────────────────────
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  chip: {
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 12,
    fontWeight: font.weights.medium,
  },
});
