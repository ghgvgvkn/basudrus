/**
 * FilterSheet — bottom-sheet modal for Discover filters.
 *
 * Pattern study (per the brief: "research how other apps do filters"):
 *   - Airbnb: bottom sheet with grouped sections, primary "Show N
 *     results" + secondary "Clear all" pinned to the bottom.
 *   - Uber / DoorDash: similar bottom sheet with categories.
 *   - Tinder: per-row tap → push to a sub-screen. We avoid that
 *     because students want to see + change everything in one place.
 *
 * Layout (after the v2 typeable-uni/major refactor):
 *   ┌──────────────────────────────────────────────────┐
 *   │ (handle)                                          │
 *   │ Filters                                  [X]      │
 *   ├──────────────────────────────────────────────────┤
 *   │ UNIVERSITY                                        │
 *   │ [ 🔍 Search 600+ universities… ]                  │
 *   │ MAJOR                                             │
 *   │ [ 🔍 Search majors… ]                             │
 *   │ YEAR                                              │
 *   │ Any · 1 · 2 · 3 · 4 · 5    (horizontal chips)    │
 *   ├──────────────────────────────────────────────────┤
 *   │ [ Reset ]            [ Show N students ]          │
 *   └──────────────────────────────────────────────────┘
 *
 * Why typeable for uni + major: the web has ~600 universities and
 * thousands of majors. A horizontal chip strip can't surface a
 * student's specific uni. We use the same TypeaheadField the Past
 * Papers upload form uses so the UX is consistent.
 *
 * Why chips for Year: there are exactly 6 sensible values (1–5 + grad).
 * A picker would be overkill — user explicitly asked to "keep the year
 * the same thing".
 *
 * `applyOnChange={false}` keeps a "draft" copy so the user can poke
 * around without the feed jumping under them; they tap "Show" to
 * commit. Useful when the available options list is long.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import { TypeaheadField, type TypeaheadOption } from './TypeaheadField';

export type DraftFilters = {
  uni: string | null;
  major: string | null;
  year: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onApply: (next: DraftFilters) => void;
  onReset: () => void;
  initial: DraftFilters;
  /** Full catalog from Supabase `universities` (~600 rows). */
  universityOptions: TypeaheadOption[];
  /** Full catalog from Supabase `uni_majors` (deduped). */
  majorOptions: TypeaheadOption[];
  /** Year is a short, fixed list — render as chips. */
  years: string[];
  /** "Show {N} students" count — recomputed live in the parent. */
  matchCount: number;
};

export function FilterSheet({
  visible,
  onClose,
  onApply,
  onReset,
  initial,
  universityOptions,
  majorOptions,
  years,
  matchCount,
}: Props) {
  const { c, mode } = useTheme();
  const [draft, setDraft] = useState<DraftFilters>(initial);

  // Reset draft to whatever the parent had when the sheet opens, so a
  // user who cancels their changes doesn't see them persist.
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const activeCount = Object.values(draft).filter(Boolean).length;

  const setField = (k: keyof DraftFilters) => (v: string | null) => {
    tap();
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop — tap to close. Separate Pressable so the sheet
          itself doesn't dismiss when tapped. */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={[styles.sheet, { backgroundColor: c.bg, borderColor: c.border }]}>
        <View style={[styles.handle, { backgroundColor: mode === 'dark' ? '#555' : '#ddd' }]} />

        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Filters{activeCount > 0 ? ` · ${activeCount}` : ''}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={c.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={{ paddingBottom: space.lg }}
          showsVerticalScrollIndicator={false}
          // Lets a tap on a TypeaheadField suggestion register even
          // when the keyboard is up.
          keyboardShouldPersistTaps="always"
        >
          <TypeaheadRow
            label="University"
            icon="school"
            placeholder="Search universities…"
            value={draft.uni ?? ''}
            options={universityOptions}
            onChange={(v) => setField('uni')(v.length > 0 ? v : null)}
          />
          <TypeaheadRow
            label="Major"
            icon="book"
            placeholder="Search majors…"
            value={draft.major ?? ''}
            options={majorOptions}
            onChange={(v) => setField('major')(v.length > 0 ? v : null)}
          />
          <FilterChipRow
            label="Year"
            icon="calendar"
            tint="#2bb673"
            options={years}
            selected={draft.year}
            onSelect={setField('year')}
          />
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <Pressable
            onPress={() => {
              tap();
              setDraft({ uni: null, major: null, year: null });
              onReset();
            }}
            style={({ pressed }) => [
              styles.resetBtn,
              {
                backgroundColor: c.bgElevated,
                borderColor: c.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.resetText, { color: c.textMuted }]}>Reset</Text>
          </Pressable>
          <Pressable
            onPress={() => { tap(); onApply(draft); onClose(); }}
            style={({ pressed }) => [
              styles.applyBtn,
              {
                backgroundColor: mode === 'dark' ? c.accent : '#111111',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.applyText, { color: mode === 'dark' ? '#000' : '#fff' }]}>
              {matchCount > 0
                ? `Show ${matchCount} student${matchCount === 1 ? '' : 's'}`
                : 'Show results'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Wraps a TypeaheadField in the same "label row + body" pattern that
 * FilterChipRow uses, so the three filter sections look unified.
 */
function TypeaheadRow({
  label,
  icon,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  placeholder: string;
  value: string;
  options: TypeaheadOption[];
  onChange: (v: string) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Ionicons name={icon} size={14} color={c.textMuted} />
        <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label.toUpperCase()}</Text>
      </View>
      <View style={styles.typeaheadWrap}>
        <TypeaheadField
          value={value}
          onChange={onChange}
          options={options}
          placeholder={placeholder}
          icon="search"
          // Allow free text so a student can filter by a uni/major
          // we haven't catalogued yet — the parent's matcher does a
          // case-insensitive contains check, so any close substring
          // narrows the feed.
          allowFreeText
          maxResults={6}
          label={label}
        />
      </View>
    </View>
  );
}

function FilterChipRow({
  label,
  icon,
  tint,
  options,
  selected,
  onSelect,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  options: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Ionicons name={icon} size={14} color={c.textMuted} />
        <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label.toUpperCase()}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <ChipButton
          label="Any"
          selected={selected === null}
          tint={tint}
          onPress={() => onSelect(null)}
        />
        {options.map(opt => (
          <ChipButton
            key={opt}
            label={opt}
            selected={selected === opt}
            tint={tint}
            onPress={() => onSelect(selected === opt ? null : opt)}
          />
        ))}
        {options.length === 0 && (
          <Text style={[styles.emptyText, { color: c.textFaint }]}>
            (none yet)
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function ChipButton({
  label,
  selected,
  tint,
  onPress,
}: {
  label: string;
  selected: boolean;
  tint: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? tint : c.bgElevated,
          borderColor: selected ? tint : c.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          {
            color: selected ? '#ffffff' : c.text,
            fontWeight: selected ? font.weights.bold : font.weights.medium,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    maxHeight: '82%',
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: space.sm,
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  title: {
    fontSize: font.sizes.xl,
    fontWeight: font.weights.bold,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: {
    flexGrow: 0,
  },
  fieldGroup: {
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.xl,
    marginBottom: space.sm,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: font.weights.bold,
  },
  typeaheadWrap: {
    paddingHorizontal: space.xl,
  },
  chipsRow: {
    paddingHorizontal: space.xl,
    gap: space.sm,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: font.sizes.sm },
  emptyText: {
    fontSize: font.sizes.sm,
    fontStyle: 'italic',
    paddingVertical: space.sm,
  },

  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resetBtn: {
    height: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.semibold,
  },
  applyBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    letterSpacing: 0.2,
  },
});
