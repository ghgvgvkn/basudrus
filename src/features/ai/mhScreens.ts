/**
 * mhScreens — public-domain mental-health self-screening instruments.
 *
 * PHQ-9 and GAD-7 are validated screening tools developed by Pfizer
 * and released into the public domain. They are NOT diagnostic tools
 * — they're starting points that help a person see whether what
 * they're feeling rises to a level worth talking to a clinician about.
 *
 * Both have been validated in Arabic. Citations:
 *   - PHQ-9: Spitzer RL et al. JAMA 1999. Arabic: AlHadi AN et al.
 *     Annals of General Psychiatry, 2017.
 *   - GAD-7: Spitzer RL et al. Arch Intern Med 2006. Arabic: Sawaya H
 *     et al. Curr Psychol, 2016.
 *
 * Honesty rules baked into how we use these:
 *   1. Every score reveal includes "this is not a diagnosis" plainly.
 *   2. PHQ-9 question 9 (self-harm) is monitored — any answer ≥ 1
 *      flags the result for the crisis-mode flow regardless of total
 *      score. The student is shown emergency resources immediately.
 *   3. We always surface the next-step recommendation tied to the
 *      severity tier, including verified therapists from the Day 13
 *      directory. Empty directory = honest "I don't have a verified
 *      provider for that range here yet" — never a fabricated name.
 */

export type ScreenId = "PHQ-9" | "GAD-7";
export type Severity = "minimal" | "mild" | "moderate" | "moderately_severe" | "severe";
export type ScreenLang = "en" | "ar";

export interface ScreenQuestion {
  /** Question prompt — translated. */
  text: string;
}

export interface ScreenAnswerOption {
  /** Score for this answer (0–3 on both PHQ-9 and GAD-7). */
  value: 0 | 1 | 2 | 3;
  /** Display label in the chosen language. */
  label: string;
}

export interface ScreenDefinition {
  id: ScreenId;
  /** Display name shown in the modal header. */
  title: string;
  /** What the screen measures, in plain language. */
  measures: string;
  /** Time-frame prompt before the questions. */
  prompt: string;
  /** Question list — all rated on the same 0–3 scale. */
  questions: ScreenQuestion[];
  /** Answer options shared across all questions. Indexed 0–3. */
  answers: ScreenAnswerOption[];
  /** Severity ranges — score ≥ min and ≤ max maps to a tier. */
  severityRanges: Array<{
    severity: Severity;
    min: number;
    max: number;
    /** Plain-language explanation shown on the result page. */
    summary: string;
  }>;
  /** Source citation, surfaced in the "About this screen" footer. */
  source: string;
}

// ─────────────────────────────────────────────────────────────────
// PHQ-9 — Patient Health Questionnaire (depression).
// ─────────────────────────────────────────────────────────────────

export const PHQ9_EN: ScreenDefinition = {
  id: "PHQ-9",
  title: "Depression check-in (PHQ-9)",
  measures: "How depression-like symptoms have been showing up in your life over the last 2 weeks.",
  prompt: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
  questions: [
    { text: "Little interest or pleasure in doing things." },
    { text: "Feeling down, depressed, or hopeless." },
    { text: "Trouble falling or staying asleep, or sleeping too much." },
    { text: "Feeling tired or having little energy." },
    { text: "Poor appetite or overeating." },
    { text: "Feeling bad about yourself — or that you are a failure or have let yourself or your family down." },
    { text: "Trouble concentrating on things, such as reading or watching TV." },
    { text: "Moving or speaking so slowly that other people could have noticed. Or the opposite — being so fidgety or restless that you've been moving around a lot more than usual." },
    { text: "Thoughts that you would be better off dead, or of hurting yourself in some way." },
  ],
  answers: [
    { value: 0, label: "Not at all" },
    { value: 1, label: "Several days" },
    { value: 2, label: "More than half the days" },
    { value: 3, label: "Nearly every day" },
  ],
  severityRanges: [
    { severity: "minimal",            min: 0,  max: 4,  summary: "Minimal symptoms. What you're feeling sounds tolerable for now — keep an eye on it, take care of basics (sleep, food, movement), and check in again if it gets heavier." },
    { severity: "mild",               min: 5,  max: 9,  summary: "Mild symptoms. Your score suggests some real distress that's worth taking seriously — small changes (talking to someone, building back small routines) can help. If it lasts more than a few weeks or worsens, talk to a clinician." },
    { severity: "moderate",           min: 10, max: 14, summary: "Moderate symptoms. This score lands at the threshold where most clinicians would recommend a conversation with a therapist or doctor. What you're feeling is real and significant. You don't have to figure this out alone." },
    { severity: "moderately_severe", min: 15, max: 19, summary: "Moderately severe symptoms. Talking to a mental-health professional is the right next step. This is not weakness or overreaction — your score reflects a level of distress that responds well to professional support." },
    { severity: "severe",             min: 20, max: 27, summary: "Severe symptoms. Please reach out to a mental-health professional this week. The depth of what you're carrying is significant, and the right support genuinely helps. If at any point you have thoughts of harming yourself, call 911 (Jordan emergency) or go to the nearest hospital." },
  ],
  source: "PHQ-9 © 1999 Pfizer Inc. Public-domain screening tool, validated in Arabic and English. Not a diagnosis — a clinician's evaluation is the only source of a diagnosis.",
};

export const PHQ9_AR: ScreenDefinition = {
  id: "PHQ-9",
  title: "فحص الاكتئاب (PHQ-9)",
  measures: "كيف ظهرت أعراض الاكتئاب في حياتك خلال آخر أسبوعين.",
  prompt: "خلال الأسبوعين الماضيين، كم مرة شعرت بأي من المشاكل التالية؟",
  questions: [
    { text: "قلة الاهتمام أو المتعة بفعل الأشياء." },
    { text: "الشعور بالحزن أو الاكتئاب أو فقدان الأمل." },
    { text: "صعوبة في النوم أو البقاء نائماً، أو النوم أكثر من اللازم." },
    { text: "الشعور بالتعب أو قلة الطاقة." },
    { text: "ضعف الشهية أو الإفراط في الأكل." },
    { text: "الشعور بالسوء تجاه نفسك — أو أنك فاشل أو خذلت نفسك أو عائلتك." },
    { text: "صعوبة في التركيز، مثل القراءة أو مشاهدة التلفاز." },
    { text: "التحرك أو التكلم ببطء شديد بحيث يمكن للآخرين ملاحظة ذلك. أو العكس — التململ أو الحركة الزائدة." },
    { text: "أفكار بأنك ستكون أفضل لو كنت ميتاً، أو أفكار بإيذاء نفسك." },
  ],
  answers: [
    { value: 0, label: "أبداً" },
    { value: 1, label: "عدة أيام" },
    { value: 2, label: "أكثر من نصف الأيام" },
    { value: 3, label: "تقريباً كل يوم" },
  ],
  severityRanges: PHQ9_EN.severityRanges.map((r) => {
    const ar = {
      minimal:            "أعراض بسيطة. ما تشعر به محتمل في الوقت الحالي — راقب نفسك، اهتم بالأساسيات (نوم، أكل، حركة)، وتفقد نفسك مرة أخرى إذا ازدادت الأعراض.",
      mild:               "أعراض خفيفة. درجتك تشير إلى ضائقة حقيقية تستحق الانتباه — تغييرات صغيرة (التحدث مع شخص، بناء روتين بسيط) ممكن تساعد. إذا استمرت أكثر من أسابيع أو ساءت، تكلم مع مختص.",
      moderate:           "أعراض متوسطة. هذه الدرجة عند الحد الذي يوصي فيه معظم المختصين بالحديث مع معالج نفسي أو طبيب. ما تشعر به حقيقي ومهم. ما عليك أن تتعامل مع هذا لوحدك.",
      moderately_severe: "أعراض متوسطة-شديدة. التحدث مع مختص في الصحة النفسية هو الخطوة الصحيحة التالية. هذا ليس ضعفاً ولا مبالغة — درجتك تعكس مستوى من الضائقة يستجيب جيداً للدعم المهني.",
      severe:             "أعراض شديدة. أرجو أن تتواصل مع مختص في الصحة النفسية هذا الأسبوع. عمق ما تحمله مهم، والدعم الصحيح يساعد فعلاً. إذا في أي وقت كان عندك أفكار لإيذاء نفسك، اتصل بـ 911 (الطوارئ في الأردن) أو اذهب لأقرب مستشفى.",
    } as const;
    return { ...r, summary: ar[r.severity] };
  }),
  source: "PHQ-9 © 1999 Pfizer Inc. أداة فحص عامة، تم التحقق من صحتها بالعربية والإنجليزية. ليست تشخيصاً — التشخيص يأتي فقط من مختص.",
};

// ─────────────────────────────────────────────────────────────────
// GAD-7 — Generalized Anxiety Disorder screen.
// ─────────────────────────────────────────────────────────────────

export const GAD7_EN: ScreenDefinition = {
  id: "GAD-7",
  title: "Anxiety check-in (GAD-7)",
  measures: "How anxiety-like symptoms have been showing up in your life over the last 2 weeks.",
  prompt: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
  questions: [
    { text: "Feeling nervous, anxious, or on edge." },
    { text: "Not being able to stop or control worrying." },
    { text: "Worrying too much about different things." },
    { text: "Trouble relaxing." },
    { text: "Being so restless that it's hard to sit still." },
    { text: "Becoming easily annoyed or irritable." },
    { text: "Feeling afraid as if something awful might happen." },
  ],
  answers: [
    { value: 0, label: "Not at all" },
    { value: 1, label: "Several days" },
    { value: 2, label: "More than half the days" },
    { value: 3, label: "Nearly every day" },
  ],
  severityRanges: [
    { severity: "minimal",  min: 0,  max: 4,  summary: "Minimal anxiety symptoms. Normal stress levels — basics (sleep, movement, talking it out) usually keep this in check." },
    { severity: "mild",     min: 5,  max: 9,  summary: "Mild anxiety. Real but manageable — grounding techniques, regular movement, and naming what specifically is worrying you all help. If it persists or interferes with daily life, talk to a clinician." },
    { severity: "moderate", min: 10, max: 14, summary: "Moderate anxiety. This score is at the threshold where talking to a mental-health professional is recommended. Anxiety at this level often responds well to therapy and, in some cases, medication." },
    { severity: "severe",   min: 15, max: 21, summary: "Severe anxiety. Please reach out to a mental-health professional this week. Anxiety at this level genuinely responds to professional support — therapy, medication, or both. You don't have to keep carrying this alone." },
  ],
  source: "GAD-7 © Spitzer, Williams, Kroenke & colleagues. Public-domain screening tool, validated in Arabic and English. Not a diagnosis.",
};

export const GAD7_AR: ScreenDefinition = {
  id: "GAD-7",
  title: "فحص القلق (GAD-7)",
  measures: "كيف ظهرت أعراض القلق في حياتك خلال آخر أسبوعين.",
  prompt: "خلال الأسبوعين الماضيين، كم مرة شعرت بأي من المشاكل التالية؟",
  questions: [
    { text: "الشعور بالعصبية أو القلق أو التوتر." },
    { text: "عدم القدرة على إيقاف القلق أو السيطرة عليه." },
    { text: "القلق المفرط حول أشياء مختلفة." },
    { text: "صعوبة في الاسترخاء." },
    { text: "التململ لدرجة صعوبة الجلوس بهدوء." },
    { text: "الانزعاج أو الغضب بسهولة." },
    { text: "الشعور بالخوف وكأن شيئاً سيئاً سيحدث." },
  ],
  answers: [
    { value: 0, label: "أبداً" },
    { value: 1, label: "عدة أيام" },
    { value: 2, label: "أكثر من نصف الأيام" },
    { value: 3, label: "تقريباً كل يوم" },
  ],
  severityRanges: GAD7_EN.severityRanges.map((r) => {
    const ar = {
      minimal:  "أعراض قلق بسيطة. مستوى توتر طبيعي — الأساسيات (نوم، حركة، التحدث) تكفي عادةً.",
      mild:     "قلق خفيف. حقيقي لكن قابل للإدارة — تقنيات التهدئة، الحركة المنتظمة، وتسمية ما يقلقك تحديداً تساعد. إذا استمر أو أثر على حياتك اليومية، تكلم مع مختص.",
      moderate: "قلق متوسط. هذه الدرجة عند الحد الذي يُنصح فيه بالحديث مع مختص. القلق بهذا المستوى يستجيب عادةً للعلاج النفسي، وأحياناً للدواء.",
      severe:   "قلق شديد. أرجو أن تتواصل مع مختص هذا الأسبوع. القلق بهذا المستوى يستجيب فعلاً للدعم المهني — علاج نفسي، دواء، أو الاثنين معاً. ما عليك أن تستمر في حمل هذا لوحدك.",
      moderately_severe: "", // unused on GAD-7
    } as const;
    return { ...r, summary: ar[r.severity] };
  }),
  source: "GAD-7 © Spitzer, Williams, Kroenke & زملاؤهم. أداة فحص عامة، تم التحقق من صحتها بالعربية والإنجليزية. ليست تشخيصاً.",
};

/** Pick the right definition for a screen + language. */
export function getScreen(id: ScreenId, lang: ScreenLang): ScreenDefinition {
  if (id === "PHQ-9") return lang === "ar" ? PHQ9_AR : PHQ9_EN;
  return lang === "ar" ? GAD7_AR : GAD7_EN;
}

/** Compute total score from an answer array. */
export function scoreScreen(answers: number[]): number {
  return answers.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0);
}

/** Find which severity tier a score falls into. */
export function severityForScore(def: ScreenDefinition, score: number): Severity {
  for (const r of def.severityRanges) {
    if (score >= r.min && score <= r.max) return r.severity;
  }
  // Defensive — should never hit; max range covers everything.
  return def.severityRanges[def.severityRanges.length - 1].severity;
}

/** PHQ-9 only: question 9 measures self-harm thoughts. Any answer
 *  ≥ 1 flags the result for crisis-mode follow-up regardless of
 *  total score. Returns false for GAD-7 (no equivalent question). */
export function isFlaggedSelfHarm(id: ScreenId, answers: number[]): boolean {
  if (id !== "PHQ-9") return false;
  const q9 = answers[8]; // 0-indexed → question 9
  return typeof q9 === "number" && q9 >= 1;
}
