/**
 * New Room — full-screen form to create a `group_rooms` row.
 *
 * Lives outside `(tabs)` so Expo Router pushes it as a sheet with the
 * native back button.
 *
 * Schema we hit (host_id is auth.uid()):
 *   subject  text
 *   date     date  (YYYY-MM-DD)
 *   time     time  (HH:MM)
 *   type     text  ('online' | 'in_person')
 *   spots    int
 *   filled   int   (always 0 on create)
 *   link     text
 *   location text
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRooms } from '@/hooks/useRooms';
import { useGameTracking } from '@/hooks/useGameTracking';
import { thump, tap, success as hSuccess, error as hError } from '@/lib/haptics';
import { palette, font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);
const NICE_HOUR = () => {
  // Round up to the next half hour.
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toTimeString().slice(0, 5);
};

const SUBJECT_PRESETS = [
  '📐 Calculus revision',
  '🧪 Chemistry problem set',
  '💻 CS coding session',
  '📚 Literature discussion',
  '🌍 History essay help',
  '🎓 General study group',
];

const SPOT_CHOICES = [2, 4, 6, 8, 10];

export default function NewRoomScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { submitRoom, busy } = useRooms();
  const { awardXP } = useGameTracking();

  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(TODAY_ISO());
  const [time, setTime] = useState(NICE_HOUR());
  const [type, setType] = useState<'online' | 'in_person'>('online');
  const [spots, setSpots] = useState(4);
  const [link, setLink] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    if (!subject.trim()) return false;
    if (!date || !time) return false;
    if (type === 'online' && !link.trim()) return false;
    if (type === 'in_person' && !location.trim()) return false;
    return true;
  }, [subject, date, time, type, link, location]);

  const onSubmit = async () => {
    if (!canSubmit || saving || busy) return;
    thump();
    setSaving(true);
    const res = await submitRoom({
      subject: subject.trim(),
      date,
      time,
      type,
      spots,
      link: type === 'online' ? link.trim() : '',
      location: type === 'in_person' ? location.trim() : '',
    });
    setSaving(false);
    if (res.ok) {
      hSuccess();
      // +25 XP for hosting a session — bigger reward for higher-effort
      // actions keeps the gamification feeling fair.
      void awardXP(25);
      router.back();
    } else {
      hError();
      Alert.alert('Could not create room', res.error ?? 'Unknown error');
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'New Study Room',
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
          contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: insets.bottom + 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Subject */}
          <Section label="What's the session about?" c={c}>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="e.g. Calculus II midterm prep"
              placeholderTextColor={c.textFaint}
              style={[styles.input, { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text }]}
              maxLength={80}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {SUBJECT_PRESETS.map(p => (
                <Pressable
                  key={p}
                  onPress={() => { tap(); setSubject(p); }}
                  style={({ pressed }) => [
                    styles.presetChip,
                    { backgroundColor: c.bgElevated, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.presetText, { color: c.text }]}>{p}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Section>

          {/* Type */}
          <Section label="Where will you meet?" c={c}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <TypeCard
                active={type === 'online'}
                onPress={() => { tap(); setType('online'); }}
                icon="videocam"
                title="Online"
                sub="Zoom, Meet, Discord…"
                c={c}
                color="#a78bfa"
              />
              <TypeCard
                active={type === 'in_person'}
                onPress={() => { tap(); setType('in_person'); }}
                icon="people"
                title="In Person"
                sub="Library, café, study room…"
                c={c}
                color="#39d27a"
              />
            </View>
            <TextInput
              value={type === 'online' ? link : location}
              onChangeText={type === 'online' ? setLink : setLocation}
              placeholder={type === 'online' ? 'Paste meeting link' : 'e.g. Main library, 2nd floor'}
              placeholderTextColor={c.textFaint}
              autoCapitalize={type === 'online' ? 'none' : 'sentences'}
              autoCorrect={type !== 'online'}
              keyboardType={type === 'online' ? 'url' : 'default'}
              style={[styles.input, { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text, marginTop: space.md }]}
            />
          </Section>

          {/* When */}
          <Section label="When?" c={c}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>DATE</Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={c.textFaint}
                  style={[styles.input, { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={10}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>TIME (24H)</Text>
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder="HH:MM"
                  placeholderTextColor={c.textFaint}
                  style={[styles.input, { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={5}
                />
              </View>
            </View>
          </Section>

          {/* Spots */}
          <Section label="How many people?" c={c}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {SPOT_CHOICES.map(n => {
                const sel = spots === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => { tap(); setSpots(n); }}
                    style={({ pressed }) => [
                      styles.spotChip,
                      {
                        backgroundColor: sel ? c.accent : c.bgElevated,
                        borderColor: sel ? c.accent : c.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.spotText,
                      { color: sel ? '#0a0a0a' : c.text, fontWeight: sel ? font.weights.bold : font.weights.medium },
                    ]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {/* Submit */}
          <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit || saving}
              style={({ pressed }) => [{ opacity: !canSubmit ? 0.45 : pressed ? 0.85 : 1 }]}
            >
              <LinearGradient
                colors={canSubmit ? ['#00d4ff', '#0099cc'] : ['#444', '#333']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submitBtn}
              >
                {saving
                  ? <ActivityIndicator color="#0a0a0a" />
                  : <>
                      <Ionicons name="add-circle" size={20} color="#0a0a0a" />
                      <Text style={styles.submitText}>Create Room</Text>
                    </>
                }
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Section({ label, c, children }: { label: string; c: ReturnType<typeof palette>; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space.xl, marginBottom: space.xl }}>
      <Text style={[styles.sectionLabel, { color: c.text }]}>{label}</Text>
      <View style={{ marginTop: space.md }}>{children}</View>
    </View>
  );
}

function TypeCard({
  active, onPress, icon, title, sub, c, color,
}: {
  active: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  c: ReturnType<typeof palette>;
  color: string;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={[
        styles.typeCard,
        {
          backgroundColor: active ? `${color}22` : c.bgElevated,
          borderColor: active ? color : c.border,
          borderWidth: active ? 2 : 1,
        },
      ]}>
        <View style={[styles.typeIcon, { backgroundColor: active ? color : c.bgCard }]}>
          <Ionicons name={icon} size={22} color={active ? '#0a0a0a' : c.textMuted} />
        </View>
        <Text style={[styles.typeTitle, { color: active ? color : c.text }]}>{title}</Text>
        <Text style={[styles.typeSub, { color: c.textMuted }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, letterSpacing: -0.2 },
  fieldLabel: { fontSize: 10, letterSpacing: 1, fontWeight: font.weights.bold, marginBottom: 6 },

  input: {
    height: 50,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    fontSize: font.sizes.md,
  },

  chipsRow: { gap: space.sm, paddingTop: space.md, paddingRight: space.xl },
  presetChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1 },
  presetText: { fontSize: font.sizes.sm },

  typeCard: { padding: space.lg, borderRadius: radius.lg, alignItems: 'flex-start', gap: 6 },
  typeIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  typeTitle: { fontSize: font.sizes.md, fontWeight: font.weights.bold },
  typeSub: { fontSize: font.sizes.xs, lineHeight: 16 },

  spotChip: {
    minWidth: 48, height: 44,
    borderRadius: radius.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  spotText: { fontSize: font.sizes.md },

  submitBtn: {
    height: 56, borderRadius: radius.pill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  submitText: { color: '#0a0a0a', fontSize: font.sizes.md, fontWeight: font.weights.bold, letterSpacing: 0.3 },
});
