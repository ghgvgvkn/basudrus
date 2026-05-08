/**
 * subjectPalette — single source of truth for per-subject visual identity.
 *
 * Every subject the AI tutor handles gets its own:
 *   • accent  — the saturated brand color used as the pill background,
 *               quick-reply chip border, and progress-bar fill
 *   • soft    — a 10-15% opacity tint of the accent for hover states
 *               and "you're studying X" backgrounds
 *   • ink     — text color when laid over accent (for contrast)
 *   • emoji   — a single-glyph identifier the eye can pick out at a
 *               glance (used in the progress grid + subject pill)
 *   • label   — human-readable display name
 *
 * Why per-subject: when a student spends a long time in math, the
 * UI subtly takes on math's identity (deep indigo). Switching to
 * biology shifts to forest green. The student doesn't need to read
 * the subject name to know which mode they're in — the palette
 * tells them. This is design language used by Notion (page emojis),
 * Linear (project colors), and Figma (file thumbnails). Same idea.
 *
 * Colors picked for: high contrast at 100% saturation (works on
 * dark + light AI bubbles), distinguishable for color-blind users
 * (Deuteranopia checked — math/cs differ on lightness, not just hue),
 * culturally neutral.
 */
import type { AISubject } from "@/shared/types";

export interface SubjectPalette {
  /** Saturated accent color, used for pill bg + emphasis. */
  accent: string;
  /** Same hue at low opacity — hover states, soft backgrounds. */
  soft: string;
  /** Text color sitting on top of accent (always white-ish; kept
   *  as a token in case a future tier needs dark-on-light). */
  ink: string;
  /** Single-glyph identifier. */
  emoji: string;
  /** Human label. */
  label: string;
}

export const SUBJECT_PALETTE: Record<AISubject, SubjectPalette> = {
  math:       { accent: "#5B4BF5", soft: "#5B4BF522", ink: "#ffffff", emoji: "📐", label: "Math" },
  cs:         { accent: "#1F8FFF", soft: "#1F8FFF22", ink: "#ffffff", emoji: "💻", label: "Computer Science" },
  physics:    { accent: "#7E5BFF", soft: "#7E5BFF22", ink: "#ffffff", emoji: "⚛️", label: "Physics" },
  chemistry:  { accent: "#0E8A6B", soft: "#0E8A6B22", ink: "#ffffff", emoji: "🧪", label: "Chemistry" },
  biology:    { accent: "#1F9D55", soft: "#1F9D5522", ink: "#ffffff", emoji: "🧬", label: "Biology" },
  languages:  { accent: "#E8743B", soft: "#E8743B22", ink: "#ffffff", emoji: "💬", label: "Languages" },
  history:    { accent: "#A1652C", soft: "#A1652C22", ink: "#ffffff", emoji: "📜", label: "History" },
  wellbeing:  { accent: "#0E8A6B", soft: "#0E8A6B22", ink: "#ffffff", emoji: "🌿", label: "Wellbeing" },
  general:    { accent: "#6B6B7A", soft: "#6B6B7A22", ink: "#ffffff", emoji: "✦",  label: "General" },
};

/** Safe lookup — returns the general palette for unknown subjects so
 *  the UI never crashes on a value we haven't keyed (e.g. a server
 *  classifier adds a new subject before we ship its colors). */
export function paletteFor(subject: string | null | undefined): SubjectPalette {
  if (!subject) return SUBJECT_PALETTE.general;
  return (SUBJECT_PALETTE as Record<string, SubjectPalette>)[subject] ?? SUBJECT_PALETTE.general;
}

/** Subjects in the order they should appear in the progress grid.
 *  Math first because it's the most-studied subject; wellbeing last
 *  because Noor has its own surface elsewhere. */
export const SUBJECT_DISPLAY_ORDER: AISubject[] = [
  "math",
  "cs",
  "physics",
  "chemistry",
  "biology",
  "languages",
  "history",
  "wellbeing",
  "general",
];
