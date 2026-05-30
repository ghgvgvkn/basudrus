/**
 * subjectPalette — single source of truth for per-subject visual identity.
 *
 * Mirrors `src/features/ai/subjectPalette.ts` on the website 1:1 so a
 * math card is the same indigo on the phone as in the browser.
 *
 * Every subject the AI tutor handles gets its own:
 *   • accent  — saturated brand color (pill background, progress bar fill)
 *   • soft    — 10-15% opacity tint of accent (card backgrounds)
 *   • ink     — text color when laid over accent (always white-ish here)
 *   • emoji   — single-glyph identifier (math 📐, biology 🧬, …)
 *   • label   — human-readable display name
 *
 * `AISubject` is duplicated as a local string union (rather than imported
 * from a shared types package) because mobile is a standalone Expo
 * workspace — no `@/shared/types` alias. Keep the keys in sync with the
 * website any time a new subject is added.
 *
 * Colors are picked for high contrast at 100% saturation against both
 * light + dark backgrounds, and stay distinguishable for Deuteranopia
 * (math/cs differ on lightness, not just hue).
 */

export type AISubject =
  | 'math'
  | 'cs'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'languages'
  | 'history'
  | 'wellbeing'
  | 'general';

export interface SubjectPalette {
  /** Saturated accent color, used for pill bg + emphasis. */
  accent: string;
  /** Same hue at low opacity — soft card backgrounds. */
  soft: string;
  /** Text color sitting on top of accent. */
  ink: string;
  /** Single-glyph identifier. */
  emoji: string;
  /** Human label. */
  label: string;
}

export const SUBJECT_PALETTE: Record<AISubject, SubjectPalette> = {
  math:       { accent: '#5B4BF5', soft: '#5B4BF522', ink: '#ffffff', emoji: '📐', label: 'Math' },
  cs:         { accent: '#1F8FFF', soft: '#1F8FFF22', ink: '#ffffff', emoji: '💻', label: 'Computer Science' },
  physics:    { accent: '#7E5BFF', soft: '#7E5BFF22', ink: '#ffffff', emoji: '⚛️', label: 'Physics' },
  chemistry:  { accent: '#0E8A6B', soft: '#0E8A6B22', ink: '#ffffff', emoji: '🧪', label: 'Chemistry' },
  biology:    { accent: '#1F9D55', soft: '#1F9D5522', ink: '#ffffff', emoji: '🧬', label: 'Biology' },
  languages:  { accent: '#E8743B', soft: '#E8743B22', ink: '#ffffff', emoji: '💬', label: 'Languages' },
  history:    { accent: '#A1652C', soft: '#A1652C22', ink: '#ffffff', emoji: '📜', label: 'History' },
  wellbeing:  { accent: '#0E8A6B', soft: '#0E8A6B22', ink: '#ffffff', emoji: '🌿', label: 'Wellbeing' },
  general:    { accent: '#6B6B7A', soft: '#6B6B7A22', ink: '#ffffff', emoji: '✦',  label: 'General' },
};

/** Safe lookup — returns the general palette for unknown subjects so
 *  the UI never crashes on a value we haven't keyed (e.g. server
 *  classifier adds a new subject before we ship its colors). */
export function paletteFor(subject: string | null | undefined): SubjectPalette {
  if (!subject) return SUBJECT_PALETTE.general;
  return (SUBJECT_PALETTE as Record<string, SubjectPalette>)[subject] ?? SUBJECT_PALETTE.general;
}

/** Subjects in the order they should appear in the progress grid.
 *  Math first because it's the most-studied subject; wellbeing toward
 *  the end because Sherlock has its own surface elsewhere. */
export const SUBJECT_DISPLAY_ORDER: AISubject[] = [
  'math',
  'cs',
  'physics',
  'chemistry',
  'biology',
  'languages',
  'history',
  'wellbeing',
  'general',
];
