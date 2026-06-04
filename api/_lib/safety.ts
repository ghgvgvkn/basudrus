/**
 * safety.ts — shared crisis/safety detection for ALL Tony surfaces.
 *
 * WHY THIS IS SHARED (vision doc §9, the Amodei lever — "trust is the product"):
 *   The crisis classifier used to live ONLY inside the wellbeing (Sherlock)
 *   endpoint. But a student in the middle of a *tutoring* session can type
 *   something alarming — "i can't do this anymore, what's the point" — and the
 *   tutor endpoint had no safety handling at all. For an app that touches young
 *   people's mental health, that gap is the single most dangerous thing in the
 *   codebase. Promoting detection to a shared lib lets EVERY surface (tutor,
 *   wellbeing, and the future unified Tony) run the same always-on check and
 *   pivot to care when it matters — regardless of which "mode" the user is in.
 *
 *   This is the always-on safety layer: it runs on every turn, and a crisis
 *   signal overrides everything else (teaching, jokes, quizzes).
 *
 * Detection is intentionally HIGH-RECALL (errs toward catching a real crisis at
 * the cost of occasional false positives). A false positive means Tony is a bit
 * gentle and shares a hotline when it wasn't strictly needed — harmless. A false
 * negative means a student in real danger gets a calculus explanation. We
 * minimise the second kind.
 *
 * Pure + synchronous: regex over the message. No LLM call, no latency, no cost —
 * so it's free to run on every single turn.
 */

export type SafetySeverity = "none" | "elevated" | "crisis" | "abuse";

const CRISIS_PATTERNS: RegExp[] = [
  // English — explicit suicide / self-harm
  /\b(kill|end)\s+(myself|me|my\s+life)\b/i,
  /\bwant(?:ing)?\s+to\s+die\b/i,
  /\bwish\s+i\s+(was|were)\s+(dead|never\s+born)\b/i,
  /\b(no|nothing|zero)\s+(point|reason)\s+(in\s+|to\s+)?(liv|going\s+on|being\s+here)/i,
  // "can't go on" / "can't take it anymore" / "can't do this anymore".
  // The "anymore" idiom requires (take|do)+(it|this)+anymore as a contiguous
  // unit so a noun in between — "can't take this CLASS anymore" — does NOT
  // false-trigger (that's ordinary student venting, not a crisis). Verified
  // against scripts/tests/safety-adversarial.test.mjs.
  /\bcan(?:'?t|not)\s+(go\s+on|(?:take|do)\s+(?:it|this)\s+anymore)\b/i,
  /\b(better\s+off\s+(dead|without\s+me)|world\s+(would\s+be\s+)?better\s+without\s+me)\b/i,
  /\b(suicid(e|al)|self[\s-]?harm|harming\s+myself|hurting\s+myself|cutting\s+myself|cut\s+myself)\b/i,
  /\bwant(?:ing)?\s+to\s+disappear\b/i,
  /\bend\s+(it|things|all)\b/i,
  /\bgive\s+up\s+on\s+(life|everything)\b/i,
  // Arabic — same set
  /بدي\s*(اموت|امووت|اقتل\s*حالي|اذي\s*حالي)/,
  /انتحار/,
  /ما\s*(بقدر|بدي)\s*(اعيش|اكمل|اكمّل)/,
  /اود\s*التخلص\s*من\s*حياتي/,
  /حياتي\s*ما\s*الها\s*معنى/,
  /ما\s*في\s*أمل/,
  /تعبت\s*من\s*الحياة/,
  /لا\s*يوجد\s*أمل/,
];

const ABUSE_PATTERNS: RegExp[] = [
  /\b(he|she|they|my\s+(dad|father|mom|mother|brother|sister|husband|wife|partner|boyfriend|girlfriend|family|stepdad|stepmom))\s+(hits|hit|hurts|hurt|beats|beat|abuses|abused|raped|rapes|attacks|attacked|assaults|assaulted)\s+me\b/i,
  /\b(i'?m|i\s+am|i\s+was|i'?ve\s+been)\s+(being\s+)?(abused|raped|attacked|assaulted|molested|beaten)\b/i,
  /\b(domestic\s+(violence|abuse))\b/i,
  /\bsomeone\s+(is\s+)?(hurting|abusing|attacking)\s+me\b/i,
  // Arabic
  /(يضربني|تضربني|بضربني|بتضربني)/,
  /(اعتدى\s*علي|اعتدت\s*علي)/,
  /(اغتصاب|اغتصبني)/,
  /عنف\s*(منزلي|اسري|أسري)/,
  /(بيأذيني|بتأذيني|بأذيني)/,
];

const ELEVATED_PATTERNS: RegExp[] = [
  /\b(panic\s+attack|having\s+a\s+panic)\b/i,
  /\b(can(?:'?t|not)\s+breathe|hyperventilat)/i,
  /\b(chest\s+(is\s+)?tight|heart\s+(is\s+)?racing)\b/i,
  /\b(not\s+real|dissociating|outside\s+my\s+body)\b/i,
  /\bshaking\s+(uncontrollably|so\s+(bad|hard|much))\b/i,
  // Arabic
  /(نوبة\s*هلع|هلع\s*شديد)/,
  /ما\s*بقدر\s*(أتنفس|اتنفس|أرتاح)/,
  /صدري\s*(ضايق|مشدود)/,
  /قلبي\s*(دقاتو\s*سريعة|دقاته\s*سريعة|بيخفق\s*بسرعة)/,
];

/**
 * Classify the safety severity of a single message.
 *   "crisis"   — suicide ideation, self-harm, hopelessness
 *   "abuse"    — disclosure of abuse, violence, assault
 *   "elevated" — panic attack, acute anxiety, dissociation
 *   "none"     — normal conversation
 */
export function detectSafetySeverity(message: string): SafetySeverity {
  if (!message || typeof message !== "string") return "none";
  const text = message.slice(0, 4000); // cap pathological payloads
  for (const re of CRISIS_PATTERNS) if (re.test(text)) return "crisis";
  for (const re of ABUSE_PATTERNS) if (re.test(text)) return "abuse";
  for (const re of ELEVATED_PATTERNS) if (re.test(text)) return "elevated";
  return "none";
}

/**
 * A tutor/general-surface crisis block. When a student signals crisis or abuse
 * while NOT in the dedicated wellbeing chat (e.g. mid-study-session, or in the
 * unified Tony), this is injected at the TOP of the system prompt so it
 * overrides the teaching persona. It tells Tony to stop teaching and become a
 * calm, present human with the right Jordan resources.
 *
 * Deliberately shorter + more directive than wellbeing's full CRISIS_MODE_BLOCK
 * — the tutor persona isn't a trained companion, so the instruction is "pivot
 * fully to care, don't try to therapise, connect them to help."
 */
export function tutorCrisisBlock(severity: SafetySeverity): string {
  if (severity !== "crisis" && severity !== "abuse") return "";
  return `═══════════════════════════════════════════
🚨 SAFETY OVERRIDE — STOP TEACHING, THIS IS A CRISIS
═══════════════════════════════════════════
The student just said something consistent with ${
    severity === "abuse"
      ? "abuse, violence, or assault"
      : "suicidal thoughts, self-harm, or hopelessness"
  }. This OVERRIDES everything else — ignore the lesson, the quiz, the homework,
the persona's usual energy. Their safety is the only thing that matters now.

DO, in this order:
  1. Stop the academic content completely. Do not finish the explanation.
  2. Validate immediately and warmly: "I'm really glad you told me this."
  3. Gently check safety: "Are you safe right now?"
  4. Stay present — "I'm not going anywhere. We can keep talking."
  5. Connect them to ONE resource below (weave it in naturally, don't dump a list).
  6. Do NOT try to "fix" it, diagnose, or promise it'll be okay. Just be present.

NEVER: refuse the conversation · use ANY humor · use quick-reply chips/buttons ·
return to the academic topic until they're ready · pretend to be a therapist.

Resources (pick 1–2 most relevant, weave them in):
🚨 Emergency (Jordan): 911
🇯🇴 Jordan National Mental Health Hotline: 06-550-8888
🇯🇴 Abuse / violence: 911 — ask for the Family Protection Department (إدارة حماية الأسرة)
🏫 Most Jordanian universities have free walk-in counselling during student-services hours.

If they describe IMMEDIATE danger, say plainly: "Right now, please call 911. I'll
stay here with you." Be honest that you're an AI, but present: "I'm an AI, but I'm
here, and what you're going through is real."`;
}
