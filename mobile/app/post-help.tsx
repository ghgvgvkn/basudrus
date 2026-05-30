/**
 * Post Help — "I need help with [subject]" composer.
 *
 * Triggered from the floating + FAB on Discover and Home. Inserts a
 * row into `help_requests` and that row shows up at the top of every
 * other student's Discover feed (the hook orders asks first).
 *
 * Schema column reminder (see /sql migrations + src/lib/supabase.ts):
 *   id, user_id, subject (course/topic), detail (multi-line body),
 *   meet_type ('online' | 'in_person' | 'either'), catalog_id (FK,
 *   auto-resolved by trigger), created_at.
 *
 * The web's PostComposer folds a separate `title` and `detail` into
 * the same `detail` column ("title\n\ndetail") so the card's first
 * line is the headline. We mirror that convention for parity — the
 * UnifiedCard reads the first line and lays out the rest as body.
 *
 * Lives at /post-help (outside (tabs)) so Expo Router pushes it as a
 * modal sheet with the native back gesture instead of swapping the
 * bottom tab.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useGameTracking } from '@/hooks/useGameTracking';
import { supabase } from '@/lib/supabase';
import { thump, tap, success as hSuccess, error as hError } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Meet = 'online' | 'in_person' | 'either';

// Common subject prefixes — tappable so students don't have to type
// everything when the topic is a popular one. Mirrors the web's
// course-catalog suggestions, simplified for mobile.
const SUBJECT_PRESETS = [
  'Calculus I',
  'Calculus II',
  'Linear Algebra',
  'Statistics',
  'Discrete Math',
  'Physics I',
  'Chemistry',
  'Biology',
  'CS / Programming',
  'Data Structures',
  'Algorithms',
  'Economics',
  'Accounting',
  'Marketing',
  'English Essay',
  'Arabic Essay',
  'Research Paper',
];

const MAX_SUBJECT = 60;
const MAX_TITLE = 80;
const MAX_DETAIL = 500;

export default function PostHelpScreen() {
  const { c, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { awardXP } = useGameTracking();

  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [meet, setMeet] = useState<Meet>('either');
  const [saving, setSaving] = useState(false);

  // Posting requires an authed session — RLS would block the insert
  // otherwise. Title needs at least 4 chars so the card has something
  // meaningful to render at the top.
  const canPost = useMemo(() => {
    return (
      !!session?.user?.id &&
      subject.trim().length >= 2 &&
      title.trim().length >= 4 &&
      !saving
    );
  }, [session?.user?.id, subject, title, saving]);

  const onSubmit = async () => {
    if (!canPost || !session?.user?.id) return;
    thump();
    setSaving(true);

    // Schema has subject + detail. Fold our separate title into detail
    // so the card's first line is the headline ("title\n\ndetail").
    const trimmedTitle = title.trim();
    const trimmedDetail = detail.trim();
    const composedDetail = trimmedDetail
      ? `${trimmedTitle}\n\n${trimmedDetail}`
      : trimmedTitle;

    const { error } = await supabase.from('help_requests').insert({
      user_id: session.user.id,
      subject: subject.trim(),
      detail: composedDetail,
      meet_type: meet,
    });

    setSaving(false);

    if (error) {
      hError();
      Alert.alert('Could not post', error.message);
      return;
    }

    hSuccess();
    // +15 XP for posting a help request — encourages students to
    // ask early instead of struggling alone.
    void awardXP(15);
    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Ask for help',
          headerTransparent: true,
          headerBackTitle: 'Back',
          headerTintColor: c.text,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: c.bg }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 64,
            paddingBottom: insets.bottom + 120,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Intro */}
          <View style={styles.intro}>
            <Text style={[styles.introTitle, { color: c.text }]}>
              What do you need help with?
            </Text>
            <Text style={[styles.introBody, { color: c.textMuted }]}>
              Other students at your university will see this and can offer to
              help. Be specific — the more context, the faster a match.
            </Text>
          </View>

          {/* Subject */}
          <Section label="Subject or course">
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="e.g. Calculus II, Organic Chemistry…"
              placeholderTextColor={c.textFaint}
              style={[
                styles.input,
                {
                  backgroundColor: c.bgElevated,
                  borderColor: c.border,
                  color: c.text,
                },
              ]}
              maxLength={MAX_SUBJECT}
              returnKeyType="next"
              autoCapitalize="words"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetRow}
            >
              {SUBJECT_PRESETS.map(p => {
                const sel = subject === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => { tap(); setSubject(p); }}
                    style={({ pressed }) => [
                      styles.presetChip,
                      {
                        backgroundColor: sel
                          ? mode === 'dark' ? c.accent : '#111'
                          : c.bgElevated,
                        borderColor: sel
                          ? mode === 'dark' ? c.accent : '#111'
                          : c.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetText,
                        {
                          color: sel
                            ? mode === 'dark' ? '#000' : '#fff'
                            : c.text,
                          fontWeight: sel ? font.weights.bold : font.weights.medium,
                        },
                      ]}
                    >
                      {p}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Section>

          {/* Title */}
          <Section label="Headline (1 line)">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Stuck on integration by parts — exam in 3 days"
              placeholderTextColor={c.textFaint}
              style={[
                styles.input,
                {
                  backgroundColor: c.bgElevated,
                  borderColor: c.border,
                  color: c.text,
                },
              ]}
              maxLength={MAX_TITLE}
            />
            <Text style={[styles.charCount, { color: c.textFaint }]}>
              {title.length}/{MAX_TITLE}
            </Text>
          </Section>

          {/* Detail */}
          <Section label="Details (optional)">
            <TextInput
              value={detail}
              onChangeText={setDetail}
              placeholder="What exactly are you stuck on? When do you need help by? Online or in person?"
              placeholderTextColor={c.textFaint}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              style={[
                styles.textarea,
                {
                  backgroundColor: c.bgElevated,
                  borderColor: c.border,
                  color: c.text,
                },
              ]}
              maxLength={MAX_DETAIL}
            />
            <Text style={[styles.charCount, { color: c.textFaint }]}>
              {detail.length}/{MAX_DETAIL}
            </Text>
          </Section>

          {/* Meet type */}
          <Section label="How do you want to meet?">
            <View style={styles.meetRow}>
              <MeetCard
                active={meet === 'online'}
                onPress={() => { tap(); setMeet('online'); }}
                icon="videocam"
                title="Online"
                color="#8b65f0"
              />
              <MeetCard
                active={meet === 'in_person'}
                onPress={() => { tap(); setMeet('in_person'); }}
                icon="people"
                title="In person"
                color="#2bb673"
              />
              <MeetCard
                active={meet === 'either'}
                onPress={() => { tap(); setMeet('either'); }}
                icon="git-merge"
                title="Either"
                color="#00b6e0"
              />
            </View>
          </Section>

          {/* Submit */}
          <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
            <Pressable
              onPress={onSubmit}
              disabled={!canPost}
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor:
                    !canPost
                      ? c.bgElevated
                      : mode === 'dark'
                        ? c.accent
                        : '#111111',
                  borderColor: !canPost ? c.border : 'transparent',
                  borderWidth: !canPost ? 1 : 0,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={mode === 'dark' ? '#000' : '#fff'} />
              ) : (
                <>
                  <Ionicons
                    name="paper-plane"
                    size={18}
                    color={
                      !canPost
                        ? c.textFaint
                        : mode === 'dark'
                          ? '#000'
                          : '#fff'
                    }
                  />
                  <Text
                    style={[
                      styles.submitText,
                      {
                        color: !canPost
                          ? c.textFaint
                          : mode === 'dark'
                            ? '#000'
                            : '#fff',
                      },
                    ]}
                  >
                    Post help request
                  </Text>
                </>
              )}
            </Pressable>
            {!canPost && !saving ? (
              <Text style={[styles.hintText, { color: c.textMuted }]}>
                {!session?.user?.id
                  ? 'Sign in to post.'
                  : subject.trim().length < 2
                    ? 'Pick or type a subject.'
                    : 'Write a headline (at least 4 characters).'}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: space.xl, marginBottom: space.xl }}>
      <Text style={[styles.sectionLabel, { color: c.text }]}>{label}</Text>
      <View style={{ marginTop: space.md }}>{children}</View>
    </View>
  );
}

function MeetCard({
  active, onPress, icon, title, color,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  color: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View
        style={[
          styles.meetCard,
          {
            backgroundColor: active ? `${color}1f` : c.bgElevated,
            borderColor: active ? color : c.border,
            borderWidth: active ? 2 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.meetIcon,
            { backgroundColor: active ? color : c.bgCard },
          ]}
        >
          <Ionicons name={icon} size={20} color={active ? '#fff' : c.textMuted} />
        </View>
        <Text
          style={[
            styles.meetTitle,
            { color: active ? color : c.text },
          ]}
        >
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  introTitle: {
    fontSize: font.sizes.xxl,
    fontWeight: font.weights.bold,
    letterSpacing: -0.5,
  },
  introBody: {
    fontSize: font.sizes.md,
    lineHeight: 21,
  },

  sectionLabel: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    letterSpacing: -0.1,
  },

  input: {
    height: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    fontSize: font.sizes.md,
  },
  textarea: {
    minHeight: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    fontSize: font.sizes.md,
    lineHeight: 22,
  },
  charCount: {
    fontSize: font.sizes.xs,
    textAlign: 'right',
    marginTop: 6,
  },

  presetRow: {
    gap: space.sm,
    paddingTop: space.md,
    paddingRight: space.xl,
  },
  presetChip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  presetText: { fontSize: font.sizes.sm },

  meetRow: { flexDirection: 'row', gap: space.sm },
  meetCard: {
    padding: space.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: 6,
  },
  meetIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  meetTitle: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.bold,
  },

  submitBtn: {
    height: 56,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  submitText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    letterSpacing: 0.3,
  },
  hintText: {
    fontSize: font.sizes.sm,
    textAlign: 'center',
    marginTop: space.md,
  },
});
