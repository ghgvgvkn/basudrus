/**
 * personaRouting — client-side classifier that decides:
 *   1. Is this a crisis message? (force-switch to Noor, no opt-in)
 *   2. Is this more emotional or more academic? (suggest a persona
 *      switch via the SwitchSuggestionCard, but never force)
 *
 * Defense-in-depth note: api/ai/wellbeing.ts ALREADY classifies
 * crisis on the server and switches Noor into CRISIS_MODE. This
 * module mirrors a SUBSET of those patterns client-side for ROUTING
 * — i.e. so we can force-route a crisis message to Noor instead of
 * letting it reach Omar's tutor endpoint. Server-side classification
 * remains the source of truth for tone-mode selection.
 *
 * Bilingual: every pattern set has English + Arabic equivalents.
 * Jordan PSUT students code-switch constantly ("I'm so مصدوم rn").
 *
 * Pattern source: kept in sync with api/ai/wellbeing.ts CRISIS_PATTERNS
 * and the AIScreen NOOR_KEYWORDS / OMAR_KEYWORDS lists. When you add
 * a pattern there, mirror it here.
 */
import type { AIPersona } from "@/shared/types";

// ─────────────────────────────────────────────────────────────────
// Crisis patterns — must mirror api/ai/wellbeing.ts CRISIS_PATTERNS.
// These FORCE-route to Noor regardless of the user's persona pick.
// Bias toward false positives is correct here: the cost of a missed
// crisis routing far outweighs the cost of routing a math question
// to Noor for one turn.
// ─────────────────────────────────────────────────────────────────

const CRISIS_PATTERNS: RegExp[] = [
  // English — explicit suicide / self-harm
  /\b(kill|end)\s+(myself|me|my\s+life)\b/i,
  /\bwant(?:ing)?\s+to\s+die\b/i,
  /\bwish\s+i\s+(was|were)\s+(dead|never\s+born)\b/i,
  /\b(no|nothing|zero)\s+(point|reason)\s+(in\s+|to\s+)?(liv|going\s+on|being\s+here)/i,
  /\bcan(?:'?t|not)\s+(go\s+on|take\s+(it|this|anymore)|do\s+this\s+anymore)\b/i,
  /\b(better\s+off\s+(dead|without\s+me)|world\s+(would\s+be\s+)?better\s+without\s+me)\b/i,
  /\b(suicid(e|al)|self[\s-]?harm|harming\s+myself|hurting\s+myself|cutting\s+myself|cut\s+myself)\b/i,
  /\bwant(?:ing)?\s+to\s+disappear\b/i,
  /\bend\s+(it|things|all)\b/i,
  /\bgive\s+up\s+on\s+(life|everything)\b/i,
  // Arabic
  /بدي\s*(اموت|امووت|اقتل\s*حالي|اذي\s*حالي)/,
  /انتحار/,
  /ما\s*(بقدر|بدي)\s*(اعيش|اكمل|اكمّل)/,
  /اود\s*التخلص\s*من\s*حياتي/,
  /حياتي\s*ما\s*الها\s*معنى/,
  /ما\s*في\s*أمل/,
  /تعبت\s*من\s*الحياة/,
  /لا\s*يوجد\s*أمل/,
];

/** Returns true if the message contains crisis-level language. The
 *  caller should force-route to Noor without showing a "want to
 *  switch?" prompt. */
export function isCrisisMessage(message: string): boolean {
  if (!message || typeof message !== "string") return false;
  // Cap input length so a pathological payload can't slow detection.
  const text = message.slice(0, 4000);
  for (const re of CRISIS_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Persona inference — soft signal used to drive the
// SwitchSuggestionCard ("This sounded more like an emotional
// question — want to switch to Noor?"). Bilingual.
// ─────────────────────────────────────────────────────────────────

const NOOR_KEYWORDS: string[] = [
  // English
  "anxious", "anxiety", "stressed", "stress", "overwhelm",
  "depressed", "depression", "sad", "lonely", "burnout", "burned out",
  "can't focus", "cant focus", "can't sleep", "cant sleep",
  "panic", "scared", "afraid", "worried", "hopeless",
  "tired", "exhausted", "drained", "motivation", "unmotivated",
  "confidence", "self-esteem", "self esteem",
  "relationship", "family", "breakup", "grief", "loss",
  "how do i cope", "i feel", "feeling",
  // Arabic — common emotional / mental-health expressions
  "متوتر", "متوترة", "قلقان", "قلقانة", "قلق",
  "حزين", "حزينة", "زعلان", "زعلانة", "مكتئب", "مكتئبة",
  "تعبان", "تعبانة", "مرهق", "مرهقة", "مخنوق", "مخنوقة",
  "ما بقدر أركز", "مش قادر أركز", "ما عندي حافز",
  "وحيد", "وحيدة", "محبط", "محبطة",
  "خايف", "خايفة", "مصدوم", "مصدومة",
  "مشاعري", "مشاعر", "نفسيتي", "نفسيتي تعبانة",
  "ضايق", "ضايقة", "ضايقني",
];

const OMAR_KEYWORDS: string[] = [
  // English
  "solve", "prove", "calculate", "integrate", "derivative", "equation",
  "explain", "why does", "how does", "what is",
  "debug", "code", "syntax", "error", "compile", "function",
  "grammar", "translate", "conjugate",
  "plan", "schedule", "study", "exam", "midterm", "final",
  "homework", "assignment", "quiz", "practice",
  "formula", "theorem", "chapter",
  // Arabic — academic vocabulary
  "احسب", "حل", "أثبت", "اثبت", "اشتقاق", "تكامل", "معادلة",
  "اشرح", "اشرحلي", "ليش", "كيف",
  "كود", "خطأ", "خطا", "دالة", "خوارزمية",
  "قواعد", "ترجم", "تصريف",
  "خطة", "جدول", "ادرس", "أدرس", "امتحان", "اختبار",
  "واجب", "تكليف", "كويز",
  "صيغة", "نظرية", "فصل",
];

/** Tokenize a message into a Set of lowercase words. Works for both
 *  Latin and Arabic via Unicode letter class \p{L}. Punctuation,
 *  whitespace, and symbols are split-points. Apostrophes inside
 *  words ("can't") stay intact. */
function tokenize(message: string): Set<string> {
  const matches = message.toLowerCase().match(/[\p{L}\p{N}'-]+/gu);
  return new Set(matches ?? []);
}

/** Match a keyword against a message correctly:
 *    • Single-word keywords match as WHOLE TOKENS (so "tired" doesn't
 *      hit "retired").
 *    • Multi-word keywords ("can't focus", "نفسيتي تعبانة") still
 *      use substring match because tokenization can't preserve them.
 *  Both paths are case-insensitive via tokenize() + .toLowerCase(). */
function keywordHit(keyword: string, lowered: string, tokens: Set<string>): boolean {
  const k = keyword.toLowerCase();
  if (k.includes(" ")) return lowered.includes(k);
  return tokens.has(k);
}

/** Soft persona suggestion. Returns the persona we'd nudge the user
 *  toward, or `current` if the signal is truly ambiguous (no keywords).
 *  NEVER force-switch on this — that's reserved for crisis classification.
 *
 *  Dual-signal rule: when a message contains BOTH academic AND emotional
 *  keywords (e.g. "I'm stressed about my calculus exam"), we lead with
 *  emotion → suggest Noor. A huge share of Jordanian-student messages
 *  carry both signals; before this rule, the keyword combination silently
 *  returned `current`, meaning whichever persona the student happened to
 *  be on won by accident. Emotion-first is the right default: Noor can
 *  always bridge back to Omar after acknowledging how the student feels.
 */
export function inferPersona(message: string, current: AIPersona): AIPersona {
  if (!message) return current;
  const lowered = message.toLowerCase();
  const tokens = tokenize(lowered);
  const hasNoor = NOOR_KEYWORDS.some((k) => keywordHit(k, lowered, tokens));
  const hasOmar = OMAR_KEYWORDS.some((k) => keywordHit(k, lowered, tokens));
  if (hasNoor && !hasOmar) return "noor";
  if (hasOmar && !hasNoor) return "omar";
  // Dual signal (both academic + emotional): lead with emotion.
  if (hasNoor && hasOmar) return "noor";
  return current;
}

// ─────────────────────────────────────────────────────────────────
// Routing decision — combines the two classifiers into one call so
// the AIScreen send-path has a single decision point. The shape
// mirrors what the SwitchSuggestionCard wants to render.
// ─────────────────────────────────────────────────────────────────

export type RoutingDecision =
  | {
      /** Force-switch to Noor; no user opt-in. */
      kind: "force_crisis";
      target: "noor";
    }
  | {
      /** Soft suggestion — show the SwitchSuggestionCard but use the
       *  user's chosen persona for THIS message. */
      kind: "suggest";
      target: AIPersona;
      current: AIPersona;
    }
  | {
      /** No routing change — just send to the user's chosen persona. */
      kind: "stay";
    };

/** Single decision point. AIScreen should call this with the user's
 *  message + their currently-selected persona, then act on the
 *  returned decision. */
export function decideRouting(
  message: string,
  current: AIPersona,
): RoutingDecision {
  if (isCrisisMessage(message)) {
    return { kind: "force_crisis", target: "noor" };
  }
  const inferred = inferPersona(message, current);
  if (inferred !== current) {
    return { kind: "suggest", target: inferred, current };
  }
  return { kind: "stay" };
}
