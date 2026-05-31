/**
 * TypeaheadField — text input + inline suggestion list.
 *
 * Used by:
 *   - Past Papers upload form (university, course, professor)
 *   - Discover filter sheet (university, major) — user asked for these
 *     to be typeable instead of fixed chip lists, since there are 600+
 *     unis and thousands of majors.
 *
 * Design choices:
 *   - Inline list (max ~6 rows) rather than a Modal so the keyboard
 *     stays open and the user can keep typing. Modal-based
 *     autocomplete dismisses the keyboard on every selection on iOS,
 *     which feels janky for a high-frequency input.
 *   - "Other / Use what I typed" affordance — if the user's input
 *     doesn't exactly match a row, they can still confirm their
 *     free-text value. The web app accepts any free-text uni name
 *     (Phase 2d background-validates new entries); mobile should
 *     match that latitude.
 *   - allowFreeText prop turns the "use what I typed" row on/off so
 *     the same component can act as a strict picker (e.g. Year) or a
 *     fuzzy autocomplete (University).
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

export type TypeaheadOption = {
  /** Stable id — usually a Supabase row id, falls back to the label. */
  id: string;
  label: string;
  /** Optional secondary line ("Amman · Jordan"). */
  sublabel?: string | null;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Optional id callback if you want the picker to also surface the
   *  Supabase row id (e.g. to populate `university_id` separately). */
  onSelectId?: (id: string | null) => void;
  options: TypeaheadOption[];
  placeholder?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** If true, an extra "Use {value}" row appears when no exact match.
   *  Default true. */
  allowFreeText?: boolean;
  /** Limit the suggestion dropdown rows. Default 6. */
  maxResults?: number;
  /** Optional accessibility / focus-style hint. */
  label?: string;
};

export function TypeaheadField({
  value,
  onChange,
  onSelectId,
  options,
  placeholder,
  icon = 'search',
  allowFreeText = true,
  maxResults = 6,
  label,
}: Props) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, maxResults);
    const hits: TypeaheadOption[] = [];
    for (const opt of options) {
      if (opt.label.toLowerCase().includes(q)) hits.push(opt);
      if (hits.length >= maxResults) break;
    }
    return hits;
  }, [options, value, maxResults]);

  const exactMatch = useMemo(
    () => options.some(o => o.label.toLowerCase() === value.trim().toLowerCase()),
    [options, value],
  );

  const showDropdown = focused && (matches.length > 0 || (!!value.trim() && allowFreeText && !exactMatch));

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: c.bgCard,
            borderColor: focused ? c.accent : c.border,
          },
        ]}
      >
        <Ionicons name={icon} size={17} color={c.textMuted} />
        <TextInput
          value={value}
          onChangeText={(v) => {
            onChange(v);
            // Clear the id pairing whenever the user edits the text —
            // they're typing something new; the caller can re-bind when
            // they tap a suggestion below.
            if (onSelectId) onSelectId(null);
          }}
          onFocus={() => setFocused(true)}
          // Delay the blur so a tap on a suggestion still registers
          // (RN closes the keyboard before press fires otherwise).
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={label}
          autoCorrect={false}
          autoCapitalize="words"
          clearButtonMode="while-editing"
          returnKeyType="done"
          style={[styles.input, { color: c.text }]}
        />
      </View>

      {showDropdown ? (
        <View style={[styles.dropdown, { backgroundColor: c.bgCard, borderColor: c.border }]}>
          <ScrollView
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 260 }}
          >
            {matches.map(opt => (
              <Pressable
                key={opt.id}
                onPress={() => {
                  onChange(opt.label);
                  if (onSelectId) onSelectId(opt.id);
                  setFocused(false);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? c.bgElevated : 'transparent',
                    borderBottomColor: c.border,
                  },
                ]}
              >
                <Text style={[styles.rowLabel, { color: c.text }]} numberOfLines={1}>
                  {opt.label}
                </Text>
                {opt.sublabel ? (
                  <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                    {opt.sublabel}
                  </Text>
                ) : null}
              </Pressable>
            ))}

            {/* Use-what-I-typed row, only when there's no exact match. */}
            {!exactMatch && allowFreeText && value.trim().length > 0 ? (
              <Pressable
                onPress={() => {
                  // Keep current value (user-typed) and clear any prior id pairing.
                  if (onSelectId) onSelectId(null);
                  setFocused(false);
                }}
                style={({ pressed }) => [
                  styles.row,
                  styles.freeRow,
                  {
                    backgroundColor: pressed ? c.bgElevated : 'transparent',
                    borderBottomColor: c.border,
                  },
                ]}
              >
                <Ionicons name="add-circle-outline" size={15} color={c.accent} />
                <Text style={[styles.rowLabel, { color: c.accent, marginLeft: 8 }]} numberOfLines={1}>
                  Use &quot;{value.trim()}&quot;
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    height: 46,
  },
  input: {
    flex: 1,
    fontSize: font.sizes.md,
    height: 46,
  },
  dropdown: {
    marginTop: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  freeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowLabel: { fontSize: font.sizes.md, fontWeight: font.weights.medium },
  rowSub: { fontSize: font.sizes.xs, marginTop: 2 },
});
