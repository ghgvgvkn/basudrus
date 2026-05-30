/**
 * Personality quiz — 8 questions that drive the cross-app match %.
 *
 * Why a top-level (non-tab) route: the quiz is a focused task. The
 * tab bar would invite users to bail mid-quiz with incomplete answers,
 * which leaves their match_quiz row in a half-filled state that the
 * scorer treats as a neutral 0.5 — worse than no answer.
 *
 * Flow
 *   1. Pull viewer's existing answers (if any) so retakes pre-select.
 *   2. One question per screen, big tap targets, swipe-style "Next".
 *   3. On submit: upsert match_quiz {user_id, answers}, then emit
 *      `bu:quiz-updated` so every open useMatchScores re-fetches and
 *      re-scores immediately. Navigate back to the originating screen.
 *
 * Surface elsewhere:
 *   - Profile tab card: "Take quiz" / "Update quiz"
 *   - Discover empty state (if hasQuiz === false): explanatory CTA
 *
 * Mirrors the web's PersonalityQuizStep but as a standalone screen
 * instead of an onboarding gateway, because mobile users typically
 * take the quiz after exploring the app.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useGameTracking } from '@/hooks/useGameTracking';
import { emitQuizUpdated } from '@/hooks/useMatchScores';
import { PERSONALITY_QUESTIONS, type AnswerKey, type PersonalityAnswers } from '@/lib/match/personalityQuestions';
import { tap, thump, success as hSuccess, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

export default function QuizScreen() {
  const { c, mode } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { awardXP } = useGameTracking();
  const userId = session?.user?.id ?? null;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<PersonalityAnswers>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Pull existing answers once so retakes start from where the user left off.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) { setLoading(false); return; }
      const { data } = await supabase
        .from('match_quiz')
        .select('answers')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      const prev = (data?.answers as PersonalityAnswers | undefined) ?? {};
      setAnswers(prev);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const total = PERSONALITY_QUESTIONS.length;
  const current = PERSONALITY_QUESTIONS[Math.min(step, total - 1)];
  const isLast = step === total - 1;
  const answered = useMemo(
    () => PERSONALITY_QUESTIONS.filter(q => answers[q.id]).length,
    [answers],
  );
  const currentValue = current ? answers[current.id] : undefined;

  const pick = (key: AnswerKey, value: string) => {
    tap();
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const goNext = useCallback(() => {
    if (!current) return;
    if (!answers[current.id]) {
      hError();
      return;
    }
    thump();
    if (step < total - 1) setStep(step + 1);
  }, [answers, current, step, total]);

  const goPrev = () => {
    tap();
    if (step > 0) setStep(step - 1);
  };

  const submit = async () => {
    if (!userId) return;
    if (answered < total) {
      hError();
      return;
    }
    setSaving(true);
    try {
      const { error: upsertErr } = await supabase
        .from('match_quiz')
        .upsert(
          { user_id: userId, answers, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
      if (upsertErr) throw upsertErr;
      hSuccess();
      // 25 XP — a real chunk because completing the quiz unlocks
      // accurate match scores everywhere.
      void awardXP(25);
      emitQuizUpdated();
      router.back();
    } catch {
      hError();
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.textMuted} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Match quiz',
          headerStyle: { backgroundColor: c.bg },
          headerTitleStyle: { color: c.text, fontWeight: '700' },
          headerTintColor: c.accent,
          headerBackTitle: 'Back',
        }}
      />

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: c.bgElevated }]}>
        <LinearGradient
          colors={['#7c3aed', '#a78bfa']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.progressFill,
            { width: `${((step + 1) / total) * 100}%` },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.xl,
          paddingBottom: insets.bottom + 120,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.stepLabel, { color: c.textMuted }]}>
          {step + 1} of {total} · {answered}/{total} answered
        </Text>

        <Text style={[styles.questionTitle, { color: c.text }]}>
          {current.question}
        </Text>
        {current.hint ? (
          <Text style={[styles.questionHint, { color: c.textMuted }]}>
            {current.hint}
          </Text>
        ) : null}

        <View style={{ gap: space.sm, marginTop: space.md }}>
          {current.options.map(opt => {
            const selected = currentValue === opt.value;
            return (
              <OptionRow
                key={opt.value}
                label={opt.label}
                emoji={opt.emoji}
                selected={selected}
                onPress={() => pick(current.id, opt.value)}
                mode={mode}
              />
            );
          })}
        </View>

        <Text style={[styles.helper, { color: c.textFaint }]}>
          Your answers update your match % with everyone else in your university.
          You can come back and edit any time.
        </Text>
      </ScrollView>

      {/* Footer nav */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: c.bgElevated,
            borderTopColor: c.border,
            paddingBottom: insets.bottom + space.md,
          },
        ]}
      >
        <Pressable
          onPress={goPrev}
          disabled={step === 0}
          style={({ pressed }) => [
            styles.navBtn,
            {
              backgroundColor: c.bg,
              borderColor: c.border,
              opacity: step === 0 ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={c.text} />
          <Text style={[styles.navText, { color: c.text }]}>Back</Text>
        </Pressable>

        {isLast ? (
          <Pressable
            onPress={submit}
            disabled={saving || answered < total}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: answered === total ? c.accent : c.bgCard,
                opacity: saving ? 0.7 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { color: answered === total ? '#000' : c.textMuted }]}>
              {saving ? 'Saving…' : 'Save & see matches'}
            </Text>
            {!saving ? (
              <Ionicons name="checkmark" size={18} color={answered === total ? '#000' : c.textMuted} />
            ) : null}
          </Pressable>
        ) : (
          <Pressable
            onPress={goNext}
            disabled={!currentValue}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: currentValue ? c.accent : c.bgCard,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { color: currentValue ? '#000' : c.textMuted }]}>
              Next
            </Text>
            <Ionicons name="chevron-forward" size={18} color={currentValue ? '#000' : c.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function OptionRow({
  label,
  emoji,
  selected,
  onPress,
  mode,
}: {
  label: string;
  emoji?: string;
  selected: boolean;
  onPress: () => void;
  mode: 'light' | 'dark';
}) {
  const { c } = useTheme();
  // Subtle press animation so the chip feels tactile on touch.
  const sc = useMemo(() => new Animated.Value(1), []);
  return (
    <Pressable
      onPressIn={() => Animated.spring(sc, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start()}
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.option,
          {
            backgroundColor: selected
              ? (mode === 'dark' ? 'rgba(167,139,250,0.18)' : 'rgba(124,58,237,0.10)')
              : c.bgCard,
            borderColor: selected ? '#a78bfa' : c.border,
            transform: [{ scale: sc }],
          },
        ]}
      >
        {emoji ? <Text style={styles.optionEmoji}>{emoji}</Text> : null}
        <Text style={[styles.optionLabel, { color: c.text }]} numberOfLines={2}>
          {label}
        </Text>
        <View
          style={[
            styles.optionRadio,
            {
              borderColor: selected ? '#a78bfa' : c.border,
              backgroundColor: selected ? '#a78bfa' : 'transparent',
            },
          ]}
        >
          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  progressTrack: { height: 4, width: '100%' },
  progressFill: { height: 4, borderRadius: 2 },

  stepLabel: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  questionTitle: {
    fontSize: font.sizes.xxl,
    fontWeight: font.weights.bold,
    fontStyle: 'italic',
    fontFamily: 'Georgia',
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  questionHint: {
    fontSize: font.sizes.md,
    lineHeight: 21,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  optionEmoji: { fontSize: 22 },
  optionLabel: { flex: 1, fontSize: font.sizes.md, fontWeight: font.weights.medium, lineHeight: 21 },
  optionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  helper: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
    marginTop: space.lg,
  },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  navText: { fontSize: font.sizes.md, fontWeight: font.weights.semibold },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  primaryText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, letterSpacing: 0.2 },
});
