/**
 * MemoryModal — full-screen modal where the student sees, edits, deletes,
 * adds, and imports the facts Tony Starrk / Sherlock remember about them.
 * Mobile twin of `src/features/ai/MemoryModal.tsx` on the web.
 *
 * Three internal phases (top-bar back button moves between them):
 *   1. list   — current memories grouped by category, each with delete
 *   2. add    — manual single-fact form (text + category chip + importance)
 *   3. import — 3-step flow:
 *               (a) copy a generated prompt to send to ChatGPT/Claude
 *               (b) paste the AI's JSON response back
 *               (c) preview the parsed entries → tap "Save all"
 *
 * Design principles (carried over from the web):
 *   - Trust the student. Delete is one tap with a confirm chip — no
 *     scary modal. Memory is theirs.
 *   - The Import flow is the headline feature here. Make it obvious
 *     and frictionless. Copy → paste → review → save.
 *   - Empty state should encourage adding memories, not feel sterile.
 *
 * Mobile-specific notes:
 *   - No clipboard package is installed in this app, so the "Copy" step
 *     uses React Native's built-in `Share` API. The system share sheet
 *     ALWAYS includes a Copy action on both iOS and Android, so the
 *     user gets the same one-tap-copy outcome without an extra dep.
 *   - The importance "slider" is rendered as 10 tappable bubbles
 *     (1..10) — react-native ships no built-in <Slider> on newer
 *     versions and the community packages are heavy. Bubble row is
 *     better UX on touch anyway (no fine motor required).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { tap, thump } from '@/lib/haptics';
import {
  buildImportPrompt,
  parseImportPayload,
  useStudentMemory,
  type MemoryCategory,
  type MemorySource,
  type ParsedImportEntry,
  type StudentMemoryRow,
} from '@/hooks/useStudentMemory';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Student's display name — fed into the import prompt so the source
   *  AI says "Ahmed is…" rather than "the student is…". */
  studentName?: string | null;
}

type Phase = 'list' | 'add' | 'import';

interface CategoryMeta {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}

const CATEGORY_META: Record<MemoryCategory, CategoryMeta> = {
  academic: { label: 'Academic', icon: 'book-outline', color: '#5B4BF5' },
  preference: { label: 'Preference', icon: 'heart-outline', color: '#C23F6C' },
  context: { label: 'Context', icon: 'location-outline', color: '#0E8A6B' },
  weakness: { label: 'Weak area', icon: 'alert-circle-outline', color: '#E8743B' },
  strength: { label: 'Strength', icon: 'star-outline', color: '#D4A017' },
  goal: { label: 'Goal', icon: 'flag-outline', color: '#4B6EF5' },
  win: { label: 'Win', icon: 'trophy-outline', color: '#0E8A6B' },
  other: { label: 'Other', icon: 'pricetag-outline', color: '#5C5C5C' },
};

export function MemoryModal({ open, onClose, studentName }: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('list');

  // Hoisted memory hook — shared across all three phases.
  //
  // Why hoist instead of letting each phase call useStudentMemory() on its
  // own? Three reasons:
  //   1. One source of truth. When AddPhase / ImportPhase write rows, the
  //      `memories` array hosted up here updates, so navigating back to
  //      ListPhase shows the new entry instantly — no second fetch, no
  //      stale view.
  //   2. One initial load. The hook fires its SELECT on mount; if every
  //      phase mounted its own copy we'd round-trip Supabase three times
  //      when the user takes the whole tour (list → add → list → import → list).
  //   3. Mobile pageSheet keeps the modal mounted while phase swaps, so
  //      the lifted state survives the inner transitions. Nothing to lose.
  //
  // Each phase gets only the slice it needs (read for list, write for the
  // others) so the component signatures stay narrow and testable.
  const memory = useStudentMemory();

  // Phase resets to 'list' when the modal closes so reopening always
  // lands the user on the overview, not on a mid-flight add/import.
  const handleClose = useCallback(() => {
    setPhase('list');
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <Header
          phase={phase}
          onBack={phase === 'list' ? null : () => setPhase('list')}
          onClose={handleClose}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 12}
        >
          {phase === 'list' && (
            <ListPhase
              memories={memory.memories}
              loading={memory.loading}
              onRemove={memory.remove}
              onAdd={() => {
                tap();
                setPhase('add');
              }}
              onImport={() => {
                tap();
                setPhase('import');
              }}
            />
          )}
          {phase === 'add' && (
            <AddPhase onAdd={memory.add} onDone={() => setPhase('list')} />
          )}
          {phase === 'import' && (
            <ImportPhase
              studentName={studentName ?? null}
              onAddMany={memory.addMany}
              onDone={() => setPhase('list')}
            />
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────

function Header({
  phase,
  onBack,
  onClose,
}: {
  phase: Phase;
  onBack: (() => void) | null;
  onClose: () => void;
}) {
  const { c } = useTheme();
  // Title: "AI memory" — the memory layer is shared across Tony Starrk
  // (tutor) AND Sherlock (wellbeing). Calling it "Tony Starrk's memory"
  // would misrepresent that.
  const title =
    phase === 'list'
      ? 'AI memory'
      : phase === 'add'
        ? 'Add a memory'
        : 'Import from another AI';
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: c.bg, borderBottomColor: c.border },
      ]}
    >
      <View style={styles.headerLeft}>
        {onBack ? (
          <Pressable
            onPress={() => {
              tap();
              onBack();
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerIconBtn,
              { opacity: pressed ? 0.55 : 1 },
            ]}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </Pressable>
        ) : null}
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        style={({ pressed }) => [
          styles.headerIconBtn,
          { opacity: pressed ? 0.55 : 1 },
        ]}
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={22} color={c.text} />
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1 — list of current memories
// ─────────────────────────────────────────────────────────────────────

function ListPhase({
  memories,
  loading,
  onRemove,
  onAdd,
  onImport,
}: {
  memories: StudentMemoryRow[];
  loading: boolean;
  onRemove: (id: string) => Promise<boolean>;
  onAdd: () => void;
  onImport: () => void;
}) {
  const { c } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      m => m.fact.toLowerCase().includes(q) || m.category.toLowerCase().includes(q),
    );
  }, [memories, query]);

  const grouped = useMemo(() => {
    const out: Partial<Record<MemoryCategory, StudentMemoryRow[]>> = {};
    for (const m of filtered) {
      (out[m.category] = out[m.category] ?? []).push(m);
    }
    return out;
  }, [filtered]);

  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.bodyIntro, { color: c.textMuted }]}>
        These are the things your AI (Tony Starrk and Sherlock) remembers about you
        across every session. You can delete anything, add new memories, or import
        facts from another AI to bootstrap.
      </Text>

      {/* Action row */}
      <View style={styles.actionRow}>
        <Pressable
          onPress={onAdd}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: c.text, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Ionicons name="add" size={14} color={c.bg} />
          <Text style={[styles.primaryBtnText, { color: c.bg }]}>Add memory</Text>
        </Pressable>
        <Pressable
          onPress={onImport}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: c.border, opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={14} color={c.text} />
          <Text style={[styles.secondaryBtnText, { color: c.text }]}>
            Import from another AI
          </Text>
        </Pressable>
      </View>

      {/* Search — only when there are enough memories to make scanning hard */}
      {memories.length > 4 ? (
        <View style={[styles.searchWrap, { backgroundColor: c.bgElevated, borderColor: c.border }]}>
          <Ionicons name="search" size={14} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search memories"
            placeholderTextColor={c.textFaint}
            style={[styles.searchInput, { color: c.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {loading && memories.length === 0 ? (
        <ActivityIndicator color={c.textMuted} style={{ marginTop: space.xxl }} />
      ) : null}

      {!loading && memories.length === 0 ? (
        <EmptyState onAdd={onAdd} onImport={onImport} />
      ) : null}

      {!loading && memories.length > 0 && filtered.length === 0 ? (
        <Text style={[styles.empty, { color: c.textFaint }]}>
          No memories match that search.
        </Text>
      ) : null}

      <View style={{ marginTop: space.lg, gap: space.xl }}>
        {(Object.entries(grouped) as Array<[MemoryCategory, StudentMemoryRow[]]>).map(
          ([cat, rows]) => (
            <CategoryGroup key={cat} category={cat} rows={rows} onDelete={onRemove} />
          ),
        )}
      </View>
    </ScrollView>
  );
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.emptyState,
        { backgroundColor: c.bgElevated, borderColor: c.border },
      ]}
    >
      <Text style={[styles.emptyTitle, { color: c.text }]}>
        Your AI doesn&apos;t know anything about you yet.
      </Text>
      <Text style={[styles.emptyBody, { color: c.textMuted }]}>
        Memories build naturally as you chat with Tony Starrk and Sherlock. You can
        also seed them — add what you&apos;d want your AI to know, or import facts
        from another AI you&apos;ve been using.
      </Text>
      <View style={[styles.actionRow, { marginTop: space.md, justifyContent: 'center' }]}>
        <Pressable
          onPress={onAdd}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: c.text, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Ionicons name="add" size={14} color={c.bg} />
          <Text style={[styles.primaryBtnText, { color: c.bg }]}>Add the first</Text>
        </Pressable>
        <Pressable
          onPress={onImport}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: c.border, opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={14} color={c.text} />
          <Text style={[styles.secondaryBtnText, { color: c.text }]}>Import</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CategoryGroup({
  category,
  rows,
  onDelete,
}: {
  category: MemoryCategory;
  rows: StudentMemoryRow[];
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const meta = CATEGORY_META[category];
  return (
    <View>
      <View style={styles.categoryHeader}>
        <Ionicons name={meta.icon} size={11} color={meta.color} />
        <Text style={[styles.categoryLabel, { color: c.textMuted }]}>
          {meta.label.toUpperCase()} · {rows.length}
        </Text>
      </View>
      <View style={{ gap: space.sm }}>
        {rows.map(row => (
          <MemoryRow key={row.id} row={row} onDelete={onDelete} />
        ))}
      </View>
    </View>
  );
}

function MemoryRow({
  row,
  onDelete,
}: {
  row: StudentMemoryRow;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      style={[
        styles.memoryRow,
        { backgroundColor: c.bgElevated, borderColor: c.border },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.memoryFact, { color: c.text }]}>{row.fact}</Text>
        <Text style={[styles.memoryMeta, { color: c.textFaint }]}>
          importance {row.importance}/10 · {row.source.replace('_', ' ')}
        </Text>
      </View>
      {confirming ? (
        <View style={styles.confirmRow}>
          <Pressable
            onPress={async () => {
              thump();
              await onDelete(row.id);
            }}
            style={({ pressed }) => [
              styles.deleteBtn,
              { opacity: pressed ? 0.75 : 1 },
            ]}
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
              { backgroundColor: c.bg, borderColor: c.border, opacity: pressed ? 0.55 : 1 },
            ]}
          >
            <Ionicons name="close" size={12} color={c.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            tap();
            setConfirming(true);
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.trashBtn,
            { opacity: pressed ? 0.55 : 0.7 },
          ]}
          accessibilityLabel="Delete memory"
        >
          <Ionicons name="trash-outline" size={16} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — add a single memory manually
// ─────────────────────────────────────────────────────────────────────

function AddPhase({
  onAdd,
  onDone,
}: {
  onAdd: (input: {
    fact: string;
    category?: MemoryCategory;
    importance?: number;
    source?: MemorySource;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  onDone: () => void;
}) {
  const { c } = useTheme();
  const [fact, setFact] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('context');
  const [importance, setImportance] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    const res = await onAdd({ fact, category, importance, source: 'manual' });
    setSubmitting(false);
    if (res.ok) {
      thump();
      onDone();
    } else {
      setError(res.error ?? "Couldn't save");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Field label="What should Tony Starrk remember?">
        <TextInput
          value={fact}
          onChangeText={setFact}
          placeholder={
            'Example: "I commute 1 hour every morning so my real study window is 6pm–10pm on weekdays."'
          }
          placeholderTextColor={c.textFaint}
          multiline
          maxLength={600}
          style={[
            styles.textarea,
            { color: c.text, backgroundColor: c.bgElevated, borderColor: c.border },
          ]}
        />
        <Text style={[styles.charCount, { color: c.textFaint }]}>
          {fact.trim().length} / 600
        </Text>
      </Field>

      <Field label="Category">
        <View style={styles.chipRow}>
          {(Object.keys(CATEGORY_META) as MemoryCategory[]).map(cat => {
            const meta = CATEGORY_META[cat];
            const active = cat === category;
            return (
              <Pressable
                key={cat}
                onPress={() => {
                  tap();
                  setCategory(cat);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? c.text : c.bgElevated,
                    borderColor: active ? c.text : c.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={meta.icon}
                  size={11}
                  color={active ? c.bg : c.textMuted}
                />
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? c.bg : c.textMuted },
                  ]}
                >
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label={`Importance: ${importance} / 10`}>
        <View style={styles.importanceRow}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
            const active = n <= importance;
            return (
              <Pressable
                key={n}
                onPress={() => {
                  tap();
                  setImportance(n);
                }}
                style={({ pressed }) => [
                  styles.importanceDot,
                  {
                    backgroundColor: active ? c.accent : c.bgElevated,
                    borderColor: active ? c.accent : c.border,
                    opacity: pressed ? 0.55 : 1,
                  },
                ]}
                accessibilityLabel={`Set importance to ${n}`}
              >
                <Text
                  style={[
                    styles.importanceNum,
                    { color: active ? '#fff' : c.textMuted },
                  ]}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.importanceLabels}>
          <Text style={[styles.importanceHint, { color: c.textFaint }]}>Trivia</Text>
          <Text style={[styles.importanceHint, { color: c.textFaint }]}>Medium</Text>
          <Text style={[styles.importanceHint, { color: c.textFaint }]}>Critical</Text>
        </View>
      </Field>

      {error ? (
        <View
          style={[
            styles.errorCard,
            { borderColor: '#C23F6C', backgroundColor: 'rgba(194,63,108,0.08)' },
          ]}
        >
          <Text style={{ color: '#C23F6C', fontSize: font.sizes.sm }}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={fact.trim().length < 4 || submitting}
        style={({ pressed }) => [
          styles.saveBtn,
          {
            backgroundColor: c.text,
            opacity: fact.trim().length < 4 || submitting ? 0.4 : pressed ? 0.8 : 1,
          },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={c.bg} />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color={c.bg} />
            <Text style={[styles.saveBtnText, { color: c.bg }]}>Save memory</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — import from another AI
// ─────────────────────────────────────────────────────────────────────

function ImportPhase({
  studentName,
  onAddMany,
  onDone,
}: {
  studentName: string | null;
  onAddMany: (
    inputs: Array<{ fact: string; category?: MemoryCategory; importance?: number }>,
    source?: MemorySource,
  ) => Promise<{ ok: boolean; inserted: number; error?: string }>;
  onDone: () => void;
}) {
  const { c } = useTheme();
  const promptText = useMemo(
    () => buildImportPrompt({ studentName: studentName ?? undefined }),
    [studentName],
  );
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<ParsedImportEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [insertedCount, setInsertedCount] = useState<number | null>(null);

  // Mobile uses the native Share sheet to give the user the prompt.
  // The system sheet always has a "Copy" action, so the result is the
  // same as the web's clipboard write — no extra dep required.
  const onSharePrompt = async () => {
    tap();
    try {
      await Share.share({ message: promptText });
    } catch {
      Alert.alert('Could not open share sheet.');
    }
  };

  const onPreview = () => {
    tap();
    setError(null);
    const parsed = parseImportPayload(pasted);
    if (!parsed) {
      setError(
        "I couldn't find a valid JSON array in what you pasted. Make sure the other AI's response starts with [ and ends with ].",
      );
      setPreview(null);
      return;
    }
    setPreview(parsed);
  };

  const onConfirm = async () => {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    const res = await onAddMany(
      preview.map(p => ({
        fact: p.fact,
        category: p.category,
        importance: p.importance,
      })),
      'imported',
    );
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save.");
      return;
    }
    thump();
    setInsertedCount(res.inserted);
    setTimeout(() => onDone(), 1200);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Step 1 — copy / share prompt */}
      <Step n={1} title="Send this prompt to the other AI">
        <Text style={[styles.bodyIntro, { color: c.textMuted, marginTop: 0 }]}>
          Open another AI (ChatGPT, Claude, anything) you&apos;ve been chatting
          with. Share / paste the prompt below into that chat — it will return a
          JSON list of facts about you.
        </Text>
        <View
          style={[
            styles.promptBox,
            { backgroundColor: c.bgElevated, borderColor: c.border },
          ]}
        >
          <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
            <Text style={[styles.promptText, { color: c.text }]} selectable>
              {promptText}
            </Text>
          </ScrollView>
        </View>
        <Pressable
          onPress={onSharePrompt}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: c.text, opacity: pressed ? 0.75 : 1, marginTop: space.md },
          ]}
        >
          <Ionicons name="share-outline" size={14} color={c.bg} />
          <Text style={[styles.primaryBtnText, { color: c.bg }]}>Share / Copy prompt</Text>
        </Pressable>
      </Step>

      {/* Step 2 — paste response */}
      <Step n={2} title="Paste the response here">
        <TextInput
          value={pasted}
          onChangeText={t => {
            setPasted(t);
            setPreview(null);
          }}
          placeholder={'[{"fact": "Ahmed is a CS student at PSUT", "category": "academic", "importance": 9}, ...]'}
          placeholderTextColor={c.textFaint}
          multiline
          style={[
            styles.textarea,
            {
              color: c.text,
              backgroundColor: c.bgElevated,
              borderColor: c.border,
              minHeight: 160,
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              fontSize: 12.5,
            },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          onPress={onPreview}
          disabled={pasted.trim().length < 4}
          style={({ pressed }) => [
            styles.secondaryBtn,
            {
              borderColor: c.border,
              marginTop: space.sm,
              opacity: pasted.trim().length < 4 ? 0.4 : pressed ? 0.55 : 1,
            },
          ]}
        >
          <Text style={[styles.secondaryBtnText, { color: c.text }]}>Preview</Text>
        </Pressable>
        {error ? (
          <View
            style={[
              styles.errorCard,
              { borderColor: '#C23F6C', backgroundColor: 'rgba(194,63,108,0.08)' },
            ]}
          >
            <Text style={{ color: '#C23F6C', fontSize: font.sizes.sm }}>{error}</Text>
          </View>
        ) : null}
      </Step>

      {/* Step 3 — review + confirm */}
      {preview ? (
        <Step
          n={3}
          title={`Review ${preview.length} memor${preview.length === 1 ? 'y' : 'ies'}`}
        >
          <View style={{ gap: space.sm }}>
            {preview.map((entry, i) => {
              const meta = CATEGORY_META[entry.category];
              return (
                <View
                  key={i}
                  style={[
                    styles.previewRow,
                    { backgroundColor: c.bgElevated, borderColor: c.border },
                  ]}
                >
                  <View style={styles.categoryHeader}>
                    <Ionicons name={meta.icon} size={10} color={meta.color} />
                    <Text
                      style={[
                        styles.categoryLabel,
                        { color: meta.color, marginLeft: 4 },
                      ]}
                    >
                      {meta.label.toUpperCase()} · {entry.importance}/10
                    </Text>
                  </View>
                  <Text style={[styles.memoryFact, { color: c.text, marginTop: 4 }]}>
                    {entry.fact}
                  </Text>
                </View>
              );
            })}
          </View>

          {insertedCount !== null ? (
            <View style={[styles.successCard, { borderColor: '#0E8A6B' }]}>
              <Ionicons name="checkmark-circle" size={16} color="#0E8A6B" />
              <Text style={{ color: '#0E8A6B', fontWeight: '700' }}>
                Imported {insertedCount} memor{insertedCount === 1 ? 'y' : 'ies'}.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={onConfirm}
              disabled={submitting}
              style={({ pressed }) => [
                styles.saveBtn,
                {
                  backgroundColor: c.text,
                  opacity: submitting ? 0.4 : pressed ? 0.8 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={c.bg} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color={c.bg} />
                  <Text style={[styles.saveBtnText, { color: c.bg }]}>
                    Save all to memory
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </Step>
      ) : null}
    </ScrollView>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={styles.stepHeader}>
        <View style={[styles.stepNum, { backgroundColor: c.text }]}>
          <Text style={[styles.stepNumText, { color: c.bg }]}>{n}</Text>
        </View>
        <Text style={[styles.stepTitle, { color: c.text }]}>{title}</Text>
      </View>
      <View style={{ marginTop: space.sm }}>{children}</View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  headerTitle: {
    fontSize: font.sizes.lg,
    fontWeight: '700',
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Body
  scrollBody: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl * 2,
  },
  bodyIntro: {
    fontSize: font.sizes.md,
    lineHeight: 21,
  },

  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    height: 38,
    borderRadius: radius.pill,
  },
  primaryBtnText: {
    fontSize: font.sizes.sm,
    fontWeight: '600',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: font.sizes.sm,
    fontWeight: '600',
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 38,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: space.md,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sizes.sm,
    padding: 0,
  },

  // Empty state
  emptyState: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: font.sizes.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: font.sizes.sm,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: space.sm,
  },
  empty: {
    fontSize: font.sizes.sm,
    textAlign: 'center',
    marginTop: space.xl,
  },

  // Memory row
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: space.sm,
  },
  categoryLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  memoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  memoryFact: {
    fontSize: font.sizes.md,
    lineHeight: 20,
  },
  memoryMeta: {
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  trashBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  deleteBtn: {
    backgroundColor: '#C23F6C',
    paddingHorizontal: space.sm,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  cancelBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Add phase
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: space.sm,
    letterSpacing: 0.2,
  },
  textarea: {
    minHeight: 110,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: font.sizes.md,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  importanceRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  importanceDot: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importanceNum: {
    fontSize: 11,
    fontWeight: '700',
  },
  importanceLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  importanceHint: {
    fontSize: 10.5,
  },

  errorCard: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  successCard: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(14,138,107,0.08)',
  },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    borderRadius: radius.pill,
    marginTop: space.xl,
  },
  saveBtnText: {
    fontSize: font.sizes.md,
    fontWeight: '700',
  },

  // Import phase
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  stepTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  promptBox: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  promptText: {
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  previewRow: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
