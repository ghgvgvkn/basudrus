/**
 * Past Papers — Upload form (mobile).
 *
 * Mirrors the web `UploadTab` (src/features/past-papers/PastPapersScreen.tsx)
 * with three mobile-specific twists:
 *   1. File picker = expo-document-picker (PDFs) + expo-image-picker
 *      (camera/library). Either path produces the same `PaperAsset`
 *      shape the hook expects.
 *   2. University autocomplete pulls from Supabase `universities` so
 *      mobile sees the same ~600-row catalog the web does. The user
 *      can still type a free-text uni — the upload hook accepts any
 *      non-empty value (the web background-validates new entries).
 *   3. Share toggle defaults OFF (strategy doc §7.2 #3 — PRIVATE
 *      locker first). Legal "I have the right to share this material"
 *      checkbox is required; the hook double-checks it too.
 *
 * The AI analyzer step is web-only for now (Claude vision call hits a
 * web-only Next API route). Mobile users still get the metadata form;
 * the analyzer can be ported when we add an Expo-friendly endpoint.
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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  usePastPapers,
  type ExamType,
  type PaperAsset,
  type Semester,
} from '@/hooks/usePastPapers';
import { useUniversities } from '@/hooks/useUniversities';
import { TypeaheadField } from '@/components/TypeaheadField';
import { tap, thump } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

const EXAM_OPTIONS: { value: ExamType; label: string }[] = [
  { value: 'midterm',  label: 'Midterm' },
  { value: 'final',    label: 'Final' },
  { value: 'quiz',     label: 'Quiz' },
  { value: 'practice', label: 'Practice' },
  { value: 'other',    label: 'Other' },
];

const SEMESTER_OPTIONS: { value: Semester; label: string }[] = [
  { value: 'fall',   label: 'Fall' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);

export default function UploadPaperScreen() {
  const { mode, c } = useTheme();
  const dark = mode === 'dark';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { upload } = usePastPapers();
  const { unis } = useUniversities();

  const [uni, setUni] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [professorName, setProfessorName] = useState('');
  const [examType, setExamType] = useState<ExamType>('midterm');
  const [semester, setSemester] = useState<Semester>('fall');
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [file, setFile] = useState<PaperAsset | null>(null);
  const [shareWithClassmates, setShareWithClassmates] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const uniOptions = useMemo(
    () =>
      unis.map(u => ({
        id: u.id,
        label: u.name,
        sublabel: [u.city, u.country].filter(Boolean).join(' · ') || null,
      })),
    [unis],
  );

  const canSubmit =
    !!file && !!uni.trim() && !!courseName.trim() && agreed && !busy;

  // ─── File pickers ────────────────────────────────────────────────
  const pickPdf = async () => {
    tap();
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setFile({
        uri: a.uri,
        name: a.name ?? 'paper.pdf',
        mimeType: a.mimeType ?? 'application/pdf',
        size: a.size ?? null,
      });
    } catch (e) {
      Alert.alert("Couldn't pick file", (e as Error).message);
    }
  };

  const pickImage = async () => {
    tap();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to attach a photo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setFile({
      uri: a.uri,
      name: a.fileName ?? `paper-${Date.now()}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
      size: a.fileSize ?? null,
    });
  };

  const takePhoto = async () => {
    tap();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to scan a paper.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setFile({
      uri: a.uri,
      name: a.fileName ?? `paper-${Date.now()}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
      size: a.fileSize ?? null,
    });
  };

  const onSubmit = async () => {
    if (!canSubmit || !file) return;
    setBusy(true);
    const res = await upload({
      uni: uni.trim(),
      courseName: courseName.trim(),
      courseCode: courseCode.trim() || null,
      professorName: professorName.trim() || null,
      examType,
      year,
      semester,
      file,
      rightToShareAgreed: agreed,
      shareWithClassmates,
    });
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Couldn't upload", res.error);
      return;
    }
    thump();
    Alert.alert(
      'Uploaded',
      shareWithClassmates
        ? 'Shared with your course — thank you!'
        : 'Saved to your private locker. You can share it any time.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: c.bg }}
      >
        {/* ─── Header ─── */}
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + space.sm,
              backgroundColor: c.bg,
              borderBottomColor: c.border,
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={16}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={26} color={c.text} />
            </Pressable>
            <Text style={[styles.title, { color: c.text }]}>Upload a paper</Text>
            <View style={{ width: 30 }} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: space.xl,
            paddingBottom: insets.bottom + 140,
            gap: space.lg,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ─── University ─── */}
          <FieldLabel label="University">
            <TypeaheadField
              value={uni}
              onChange={setUni}
              options={uniOptions}
              placeholder="Type your university (any in the world)"
              icon="school-outline"
              allowFreeText
              label="University"
            />
          </FieldLabel>

          {/* ─── Course ─── */}
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              <FieldLabel label="Course">
                <PlainInput
                  value={courseName}
                  onChangeText={setCourseName}
                  placeholder="e.g. Operating Systems"
                  autoCapitalize="words"
                />
              </FieldLabel>
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Code (optional)">
                <PlainInput
                  value={courseCode}
                  onChangeText={setCourseCode}
                  placeholder="CS340"
                  autoCapitalize="characters"
                />
              </FieldLabel>
            </View>
          </View>

          {/* ─── Professor ─── */}
          <FieldLabel label="Professor (optional)">
            <PlainInput
              value={professorName}
              onChangeText={setProfessorName}
              placeholder="e.g. Dr. Ahmad Hamdan"
              autoCapitalize="words"
            />
          </FieldLabel>

          {/* ─── Exam type ─── */}
          <FieldLabel label="Exam type">
            <ChipPicker
              options={EXAM_OPTIONS}
              value={examType}
              onSelect={(v) => { tap(); setExamType(v); }}
            />
          </FieldLabel>

          {/* ─── Semester + Year ─── */}
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Semester">
                <ChipPicker
                  options={SEMESTER_OPTIONS}
                  value={semester}
                  onSelect={(v) => { tap(); setSemester(v); }}
                />
              </FieldLabel>
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Year">
                <ChipPicker
                  options={YEAR_OPTIONS.map(y => ({ value: y, label: String(y) }))}
                  value={year}
                  onSelect={(v) => { tap(); setYear(v); }}
                />
              </FieldLabel>
            </View>
          </View>

          {/* ─── File picker ─── */}
          <FieldLabel label="File">
            <View style={[styles.fileBox, { backgroundColor: c.bgCard, borderColor: c.border }]}>
              {file ? (
                <View style={styles.fileSelected}>
                  <View style={[styles.fileIconWrap, { backgroundColor: c.accentSoft }]}>
                    <Ionicons
                      name={file.mimeType?.startsWith('image') ? 'image' : 'document-text'}
                      size={20}
                      color={c.accent}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.fileName, { color: c.text }]} numberOfLines={1}>
                      {file.name}
                    </Text>
                    <Text style={[styles.fileMeta, { color: c.textMuted }]}>
                      {file.size ? `${Math.round(file.size / 1024)} KB · ` : ''}{file.mimeType ?? ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => { tap(); setFile(null); }}
                    hitSlop={10}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Ionicons name="close-circle" size={20} color={c.textMuted} />
                  </Pressable>
                </View>
              ) : (
                <Text style={[styles.filePlaceholder, { color: c.textMuted }]}>
                  Choose a PDF, take a photo, or upload from your library.
                </Text>
              )}

              <View style={styles.fileButtonsRow}>
                <FileButton icon="document-attach" label="PDF" onPress={pickPdf} />
                <FileButton icon="camera" label="Camera" onPress={takePhoto} />
                <FileButton icon="image" label="Library" onPress={pickImage} />
              </View>
            </View>
          </FieldLabel>

          {/* ─── Share toggle ─── */}
          <View style={[styles.shareCard, { backgroundColor: c.bgCard, borderColor: c.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.shareTitle, { color: c.text }]}>
                Share with my course&apos;s students
              </Text>
              <Text style={[styles.shareBody, { color: c.textMuted }]}>
                {shareWithClassmates
                  ? `Visible to other students at ${uni.trim() || 'your university'} taking ${courseName.trim() || 'this course'}.`
                  : 'Default OFF. Your paper stays in your private locker — only you can see it.'}
              </Text>
            </View>
            <Switch
              value={shareWithClassmates}
              onValueChange={(v) => { tap(); setShareWithClassmates(v); }}
              trackColor={{ false: c.bgElevated, true: c.accent }}
              thumbColor="#fff"
            />
          </View>

          {/* ─── Right-to-share ack ─── */}
          <Pressable
            onPress={() => { tap(); setAgreed(v => !v); }}
            style={({ pressed }) => [
              styles.consentRow,
              { borderColor: c.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: agreed ? c.accent : c.border,
                  backgroundColor: agreed ? c.accent : 'transparent',
                },
              ]}
            >
              {agreed ? <Ionicons name="checkmark" size={14} color={dark ? '#000' : '#fff'} /> : null}
            </View>
            <Text style={[styles.consentText, { color: c.textMuted }]}>
              <Text style={{ color: c.text, fontWeight: font.weights.bold }}>
                I have the right to share this material.{' '}
              </Text>
              We never republish exam questions verbatim — Tony Starrk learns
              patterns and refers students back to the original.
            </Text>
          </Pressable>

          {/* ─── Submit ─── */}
          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submit,
              {
                backgroundColor: canSubmit ? c.accent : c.bgElevated,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={dark ? '#000' : '#fff'} />
            ) : (
              <>
                <Ionicons
                  name="cloud-upload"
                  size={18}
                  color={canSubmit ? (dark ? '#000' : '#fff') : c.textMuted}
                />
                <Text
                  style={[
                    styles.submitText,
                    { color: canSubmit ? (dark ? '#000' : '#fff') : c.textMuted },
                  ]}
                >
                  {shareWithClassmates ? 'Upload + share' : 'Upload to my locker'}
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

function PlainInput(props: React.ComponentProps<typeof TextInput>) {
  const { c } = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={c.textFaint}
      style={[
        styles.plainInput,
        { backgroundColor: c.bgCard, borderColor: c.border, color: c.text },
        props.style,
      ]}
    />
  );
}

function ChipPicker<T extends string | number>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onSelect(opt.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? c.accent : c.bgCard,
                borderColor: active ? c.accent : c.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: active ? '#000' : c.text,
                  fontWeight: active ? font.weights.bold : font.weights.medium,
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FileButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fileBtn,
        {
          backgroundColor: c.bgElevated,
          borderColor: c.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={c.text} />
      <Text style={[styles.fileBtnText, { color: c.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    height: 44,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.sizes.lg,
    fontWeight: font.weights.semibold,
    letterSpacing: -0.2,
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: font.weights.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  row2: { flexDirection: 'row', gap: space.md },

  plainInput: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    fontSize: font.sizes.md,
  },

  chipRow: { gap: space.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: font.sizes.sm },

  // File picker
  fileBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.md,
    gap: space.md,
  },
  fileSelected: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  fileIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { fontSize: font.sizes.md, fontWeight: font.weights.semibold },
  fileMeta: { fontSize: font.sizes.xs, marginTop: 2 },
  filePlaceholder: { fontSize: font.sizes.sm, lineHeight: 19 },
  fileButtonsRow: { flexDirection: 'row', gap: space.sm },
  fileBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  fileBtnText: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold },

  // Share
  shareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  shareTitle: { fontSize: font.sizes.md, fontWeight: font.weights.bold },
  shareBody: { fontSize: font.sizes.sm, lineHeight: 18 },

  // Consent
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  consentText: { flex: 1, fontSize: font.sizes.sm, lineHeight: 19 },

  // Submit
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 54,
    borderRadius: radius.lg,
  },
  submitText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, letterSpacing: 0.2 },
});
