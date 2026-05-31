/**
 * ChoiceCard — tappable option buttons that appear below an assistant
 * bubble when Tony Starrk or Sherlock has asked a question with a
 * small set of likely answers.
 *
 * Visual reference: the user shared a screenshot of Claude Code's
 * AskUserQuestion UI — numbered cards, each with a title and short
 * description, tap to choose. This component matches that pattern
 * adapted for mobile (no number keys to press, no Submit button; one
 * tap = one send).
 *
 * Pattern:
 *   - The parent (Bubble in ai.tsx) calls `parseAssistantMessage()`
 *     on the assistant text. If a `choices` array comes back, the
 *     bubble renders the prose first and this card immediately below.
 *   - Tapping an option calls `onPick(label)` with the EXACT label
 *     the model emitted, so the conversation transcript reads as if
 *     the student had typed it themselves. That keeps the history
 *     drawer and the durable memory layer working with no special
 *     casing.
 *   - We deliberately omit Submit / Back / Skip from the screenshot —
 *     in a chat surface the composer already serves "type my own
 *     answer", and tapping a card IS the submit.
 *
 * Why a fully tap-only flow vs. the multi-button approach in the
 * screenshot: mobile thumbs prefer single-tap decisions; if the user
 * wants to elaborate they can still type a free-form reply into the
 * composer, which is sitting one inch below.
 *
 * Disabled state is handled by the parent — when the user has hit the
 * 10/day free-tier quota, the parent skips rendering the card and
 * shows the upgrade prompt instead. Wiring this into the card itself
 * would couple it to product-tier state for no real win.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { tap } from '@/lib/haptics';
import type { ChoiceItem } from '@/lib/parseChoices';

interface Props {
  choices: ChoiceItem[];
  /** Fires with the chosen label — caller wires this into the same
   *  send() the typed composer uses. */
  onPick: (label: string) => void;
  /** Optional Tony-purple-ish accent so the cards feel native to the
   *  AI tab's visual language. Defaults to the theme accent. */
  accent?: string;
}

export function ChoiceCard({ choices, onPick, accent }: Props) {
  const { c } = useTheme();
  const accentColor = accent ?? c.accent;
  return (
    <View style={styles.wrap}>
      {choices.map((choice, i) => (
        <Pressable
          key={`${i}-${choice.label}`}
          onPress={() => {
            tap();
            onPick(choice.label);
          }}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: c.bgElevated,
              borderColor: pressed ? accentColor : c.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={choice.label}
          accessibilityHint={choice.hint}
        >
          <View style={{ flex: 1, paddingRight: space.sm }}>
            <Text style={[styles.label, { color: c.text }]} numberOfLines={2}>
              {choice.label}
            </Text>
            {choice.hint ? (
              <Text style={[styles.hint, { color: c.textMuted }]} numberOfLines={2}>
                {choice.hint}
              </Text>
            ) : null}
          </View>
          {/* Number badge — matches the keyboard-shortcut affordance in
              Claude's web UI from the screenshot. On mobile there's no
              keyboard, but the badge is still useful as a quiet visual
              index so options feel ordered, not arbitrary. */}
          <View
            style={[
              styles.badge,
              { borderColor: c.border, backgroundColor: c.bg },
            ]}
          >
            <Text style={[styles.badgeText, { color: c.textMuted }]}>
              {i + 1}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    marginTop: space.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  label: {
    fontSize: font.sizes.md,
    fontWeight: '600',
    lineHeight: 20,
  },
  hint: {
    fontSize: font.sizes.sm,
    marginTop: 3,
    lineHeight: 18,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
