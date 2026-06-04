/**
 * modelTiering.ts — route HARD questions to a stronger model, keep everyday
 * chat on the cheap/fast path.
 *
 * THE IDEA (from docs/one-tony-vision.md §7a):
 *   Today every Tony reply uses the cheapest model (Haiku / Groq Llama). That's
 *   fast and near-free, but it's not the sharpest brain for genuinely hard work
 *   — multi-step proofs, tricky algorithms, "explain WHY step by step" requests.
 *   This module detects those moments and signals the caller to escalate to a
 *   stronger Anthropic model (Sonnet) for that turn ONLY. Casual chat stays
 *   cheap. The student gets a noticeably smarter answer exactly when it matters,
 *   and you pay the premium on only the ~10-20% of turns that need it.
 *
 * DESIGN:
 *   - Pure + synchronous: a heuristic over the user's last message. No extra LLM
 *     call, no latency, no cost to decide. (A "classifier LLM call" would add
 *     latency to EVERY turn — not worth it; the heuristic catches the clear-cut
 *     hard cases, which is the 80/20.)
 *   - Conservative: when unsure, return the cheap tier. Escalating is a cost, so
 *     we only escalate on strong signals of genuine difficulty.
 *   - Env-gated: the strong model id comes from SMART_TIER_MODEL. If that env var
 *     is unset, shouldEscalate() still classifies, but the caller treats "no
 *     strong model configured" as "stay on the normal path" — so deploying this
 *     code changes NOTHING until you set the env var. Safe by default.
 *
 * WHY A HEURISTIC AND NOT JUST "always use Sonnet":
 *   Cost + speed. Sonnet is ~10x the price and slower. For "what's photosynthesis"
 *   or "thanks!" Haiku is great and instant. Tiering = smart where it counts,
 *   fast/cheap everywhere else. That economics is what lets the free tier stay
 *   generous while Pro funds the hard calls.
 */

/** Tier decision for one turn. */
export interface ModelTierDecision {
  /** true → caller should use the strong model (Anthropic Sonnet) for this turn. */
  escalate: boolean;
  /** Short reason, for logging/telemetry (never shown to the user). */
  reason: string;
}

/**
 * The strong-tier model id, from env. Returns "" when unset — the caller MUST
 * treat "" as "no escalation available" and stay on the normal path. We don't
 * hardcode a default model id so a deploy can't silently start spending on a
 * pricier model without the operator explicitly opting in.
 */
export function strongTierModel(): string {
  return (process.env.SMART_TIER_MODEL || "").trim();
}

// ── Signals of a genuinely hard question ───────────────────────────────────

// Multi-step / reasoning verbs that imply the student wants worked depth, not a
// one-liner. "prove", "derive", "step by step", etc.
const HARD_INTENT_RE =
  /\b(prove|proof|derive|derivation|step[\s-]?by[\s-]?step|show your work|explain why|walk me through|rigor(?:ous|ously)?|from first principles)\b/i;

// Advanced academic topics where shallow answers are commonly wrong. Kept
// deliberately specific — generic "math" or "science" wouldn't justify the cost.
const HARD_TOPIC_RE =
  /\b(integral|integrate|derivative|differentiat|limit|theorem|lemma|matrix|matrices|eigen|differential equation|big[\s-]?o|complexity analysis|dynamic programming|recursion|induction|np[\s-]?complete|asymptotic|stoichiometr|equilibrium constant|thermodynamic|quantum|relativit)\b/i;

// Code-task signals: writing/fixing/optimising real code (not "what is a
// variable"). A fenced code block, or an explicit code verb + language.
const CODE_BLOCK_RE = /```[\s\S]*```/;
const CODE_TASK_RE =
  /\b(debug|refactor|optimi[sz]e|implement|algorithm|time complexity|space complexity|stack trace|segfault|null pointer|race condition|big o)\b/i;

// Math-density signal: a message with several operators/equations is usually a
// real problem to solve, not chit-chat. Counts arithmetic/relational operators.
function looksMathHeavy(text: string): boolean {
  const ops = (text.match(/[=+\-*/^√∫∑±≤≥≠]|\\frac|\\int|\\sum|\\sqrt/g) || []).length;
  return ops >= 4;
}

/**
 * Decide whether THIS user message warrants the strong model.
 *
 * @param userText  the latest user message (plain text)
 * @param opts.hasAttachment  true if a photo/PDF rode along — homework photos
 *        are almost always a real problem to solve, so they bias toward escalation
 *        (but only when combined with some length/among other signals, to avoid
 *        escalating a trivial "what's this word" photo).
 */
export function decideModelTier(
  userText: string,
  opts: { hasAttachment?: boolean } = {},
): ModelTierDecision {
  const text = (userText || "").trim();
  if (!text) return { escalate: false, reason: "empty" };

  // Very short messages are almost never hard ("hi", "thanks", "ok cool").
  // Guard first so a stray keyword in a 2-word message can't escalate.
  if (text.length < 12 && !CODE_BLOCK_RE.test(text)) {
    return { escalate: false, reason: "too_short" };
  }

  if (HARD_INTENT_RE.test(text)) return { escalate: true, reason: "hard_intent" };
  if (CODE_BLOCK_RE.test(text)) return { escalate: true, reason: "code_block" };
  if (HARD_TOPIC_RE.test(text)) return { escalate: true, reason: "hard_topic" };
  if (CODE_TASK_RE.test(text)) return { escalate: true, reason: "code_task" };
  if (looksMathHeavy(text)) return { escalate: true, reason: "math_heavy" };

  // A homework attachment + a non-trivial question is usually worth the smart
  // model (student is stuck on a real problem and photographed it).
  if (opts.hasAttachment && text.length >= 30) {
    return { escalate: true, reason: "attachment_with_question" };
  }

  return { escalate: false, reason: "default_cheap" };
}
