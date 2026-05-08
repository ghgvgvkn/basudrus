/**
 * MentalHealthScreenModal — full-screen step-through for taking a
 * PHQ-9 or GAD-7 self-screen. Three phases:
 *
 *   1. Pick screen (PHQ-9 or GAD-7) + language. Skipped if the
 *      caller passed a screen prop.
 *   2. Question-by-question flow with progress bar and 4 answer
 *      buttons per question. Back / Next navigation.
 *   3. Result page — score, severity tier, plain-language summary,
 *      verified therapist suggestions for that tier, honest "this
 *      is not a diagnosis" disclaimer.
 *
 * Design principles, all stricter than they have to be on purpose:
 *   • The "this is not a diagnosis" line is always visible on the
 *     result page — large, not buried. Same in Arabic.
 *   • Crisis flag (PHQ-9 Q9 ≥ 1) routes to a dedicated screen with
 *     emergency resources first, before the regular result page.
 *   • Severity tier copy comes from mhScreens.ts, not AI generation
 *     — these phrasings are reviewed once, used everywhere.
 *   • Therapist list comes from the verified directory only —
 *     empty list = honest "I don't have a verified provider yet".
 */
import { useState, type ReactNode } from "react";
import {
  X, ArrowLeft, AlertTriangle, Phone, ExternalLink, Heart, Check,
} from "lucide-react";
import {
  type ScreenId, type ScreenLang, type Severity,
  getScreen, scoreScreen, severityForScore, isFlaggedSelfHarm,
} from "./mhScreens";
import { useMhScreens } from "./useMhScreens";
import { useTherapists, type Therapist } from "./useTherapists";

interface Props {
  /** Optional pre-selected screen. If undefined, the modal opens
   *  on the picker step. */
  initialScreen?: ScreenId;
  /** Initial language. Defaults to "en". */
  initialLang?: ScreenLang;
  /** Called when the user taps the close button or completes the
   *  flow. Caller is responsible for unmounting. */
  onClose: () => void;
  /** Optional callback fired AFTER a result is saved, with the
   *  score / severity / flag — caller can route to crisis flow,
   *  push a message into the chat, etc. */
  onResultSaved?: (result: {
    screen: ScreenId;
    score: number;
    severity: Severity;
    flaggedSelfHarm: boolean;
  }) => void;
}

type Phase =
  | { kind: "pick" }
  | { kind: "running"; screen: ScreenId; lang: ScreenLang; answers: number[]; index: number }
  | { kind: "crisis"; screen: ScreenId; lang: ScreenLang; score: number; severity: Severity }
  | { kind: "result"; screen: ScreenId; lang: ScreenLang; score: number; severity: Severity; flagged: boolean };

export function MentalHealthScreenModal({
  initialScreen, initialLang = "en", onClose, onResultSaved,
}: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialScreen
      ? { kind: "running", screen: initialScreen, lang: initialLang, answers: [], index: 0 }
      : { kind: "pick" }
  );
  const screens = useMhScreens();
  const therapists = useTherapists();

  const handleStart = (screen: ScreenId, lang: ScreenLang) => {
    setPhase({ kind: "running", screen, lang, answers: [], index: 0 });
  };

  const handleAnswer = async (value: 0 | 1 | 2 | 3) => {
    if (phase.kind !== "running") return;
    const def = getScreen(phase.screen, phase.lang);
    const nextAnswers = [...phase.answers];
    nextAnswers[phase.index] = value;
    const nextIndex = phase.index + 1;
    if (nextIndex < def.questions.length) {
      setPhase({ ...phase, answers: nextAnswers, index: nextIndex });
      return;
    }
    // Last question — score + persist + transition.
    const score = scoreScreen(nextAnswers);
    const severity = severityForScore(def, score);
    const flagged = isFlaggedSelfHarm(phase.screen, nextAnswers);
    // Save best-effort — failures don't block the result reveal.
    void screens.save({
      screen: phase.screen,
      score,
      severity,
      answers: nextAnswers,
      flaggedSelfHarm: flagged,
      lang: phase.lang,
    });
    onResultSaved?.({ screen: phase.screen, score, severity, flaggedSelfHarm: flagged });
    if (flagged) {
      setPhase({ kind: "crisis", screen: phase.screen, lang: phase.lang, score, severity });
    } else {
      setPhase({ kind: "result", screen: phase.screen, lang: phase.lang, score, severity, flagged: false });
    }
  };

  const handleBack = () => {
    if (phase.kind !== "running") return;
    if (phase.index === 0) {
      // At question 1 — go back to picker (or close if forced screen).
      if (initialScreen) {
        onClose();
      } else {
        setPhase({ kind: "pick" });
      }
      return;
    }
    setPhase({ ...phase, index: phase.index - 1 });
  };

  return (
    <Shell onClose={onClose} dir={phase.kind === "running" || phase.kind === "result" || phase.kind === "crisis"
      ? (phase.lang === "ar" ? "rtl" : "ltr")
      : "ltr"}>
      {phase.kind === "pick" && <PickPhase onStart={handleStart} initialLang={initialLang} />}
      {phase.kind === "running" && (
        <RunningPhase
          phase={phase}
          onAnswer={handleAnswer}
          onBack={handleBack}
        />
      )}
      {phase.kind === "crisis" && (
        <CrisisPhase
          phase={phase}
          therapists={therapists.forSeverity("crisis")}
          onContinue={() => setPhase({ kind: "result", screen: phase.screen, lang: phase.lang, score: phase.score, severity: phase.severity, flagged: true })}
        />
      )}
      {phase.kind === "result" && (
        <ResultPhase
          phase={phase}
          therapists={therapists.forSeverity(phase.severity)}
          onClose={onClose}
        />
      )}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shell — fixed full-screen container with safe-area padding +
// close button. Accepts a `dir` prop so RTL flows correctly when
// the user picks Arabic.
// ─────────────────────────────────────────────────────────────────

function Shell({ children, onClose, dir }: { children: ReactNode; onClose: () => void; dir: "ltr" | "rtl" }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      dir={dir}
      className="fixed inset-0 z-[100] bg-bg flex flex-col"
    >
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink/8 bg-bg/95 backdrop-blur">
        <div className="inline-flex items-center gap-2 text-[13px] text-ink/70">
          <Heart size={14} className="text-[#0E8A6B]" />
          <span className="font-medium">Mental health check-in</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 1 — Picker
// ─────────────────────────────────────────────────────────────────

function PickPhase({ onStart, initialLang }: { onStart: (s: ScreenId, l: ScreenLang) => void; initialLang: ScreenLang }) {
  const [lang, setLang] = useState<ScreenLang>(initialLang);
  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-8 md:py-12">
      <h1 className="font-serif italic text-3xl md:text-4xl text-ink leading-tight">
        How are you doing, really?
      </h1>
      <p className="mt-3 text-[15px] text-ink/65 leading-relaxed">
        These are validated 2-minute self-screens used worldwide. They're <span className="font-semibold text-ink/85">not a diagnosis</span> — only a clinician can diagnose. They're a check-in, so you have a clearer picture of where you are right now.
      </p>

      {/* Language toggle */}
      <div className="mt-6 inline-flex items-center gap-1 p-0.5 rounded-full bg-ink/5">
        <button
          onClick={() => setLang("en")}
          className={"h-8 px-3.5 rounded-full text-xs font-medium transition " + (lang === "en" ? "bg-bg text-ink shadow-sm" : "text-ink/55")}
        >English</button>
        <button
          onClick={() => setLang("ar")}
          className={"h-8 px-3.5 rounded-full text-xs font-medium transition " + (lang === "ar" ? "bg-bg text-ink shadow-sm" : "text-ink/55")}
        >العربية</button>
      </div>

      <div className="mt-6 space-y-3">
        <ScreenCard
          title={lang === "ar" ? "فحص الاكتئاب (PHQ-9)" : "Depression check-in (PHQ-9)"}
          subtitle={lang === "ar" ? "9 أسئلة، حوالي دقيقتين." : "9 questions, about 2 minutes."}
          body={lang === "ar"
            ? "كيف ظهرت أعراض الاكتئاب في حياتك خلال آخر أسبوعين."
            : "How depression-like symptoms have been showing up in your life over the last 2 weeks."}
          onStart={() => onStart("PHQ-9", lang)}
        />
        <ScreenCard
          title={lang === "ar" ? "فحص القلق (GAD-7)" : "Anxiety check-in (GAD-7)"}
          subtitle={lang === "ar" ? "7 أسئلة، أقل من دقيقتين." : "7 questions, under 2 minutes."}
          body={lang === "ar"
            ? "كيف ظهرت أعراض القلق في حياتك خلال آخر أسبوعين."
            : "How anxiety-like symptoms have been showing up in your life over the last 2 weeks."}
          onStart={() => onStart("GAD-7", lang)}
        />
      </div>

      <div className="mt-8 rounded-2xl bg-ink/3 border border-ink/8 px-4 py-3 text-[12.5px] text-ink/60 leading-relaxed">
        Your answers are private. Stored against your account with row-level security — nobody else can read them, including support staff. You can take a screen as many times as you want.
      </div>
    </div>
  );
}

function ScreenCard({ title, subtitle, body, onStart }: { title: string; subtitle: string; body: string; onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="w-full text-start rounded-2xl border border-ink/10 hover:border-ink/25 hover:bg-ink/[2%] transition p-4 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink text-[15px]">{title}</div>
          <div className="text-[12.5px] text-ink/55 mt-0.5">{subtitle}</div>
          <p className="mt-2 text-[13.5px] text-ink/70 leading-relaxed">{body}</p>
        </div>
        <div className="shrink-0 w-9 h-9 rounded-full bg-ink text-bg inline-flex items-center justify-center text-sm font-bold mt-1">→</div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 2 — Running the screen
// ─────────────────────────────────────────────────────────────────

function RunningPhase({
  phase, onAnswer, onBack,
}: {
  phase: Extract<Phase, { kind: "running" }>;
  onAnswer: (v: 0 | 1 | 2 | 3) => void;
  onBack: () => void;
}) {
  const def = getScreen(phase.screen, phase.lang);
  const total = def.questions.length;
  const q = def.questions[phase.index];
  const progress = ((phase.index) / total) * 100;
  const lang = phase.lang;

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6 md:py-8">
      {/* Progress + back */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label={lang === "ar" ? "رجوع" : "Back"}
          className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
        >
          <ArrowLeft size={18} className={lang === "ar" ? "rotate-180" : ""} />
        </button>
        <div className="flex-1">
          <div className="h-1.5 rounded-full bg-ink/8 overflow-hidden">
            <div
              className="h-full bg-[#0E8A6B] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="text-[12px] text-ink/55 tabular-nums shrink-0">
          {phase.index + 1} / {total}
        </div>
      </div>

      {/* Prompt + question */}
      <div className="mt-8">
        <div className="text-[12px] uppercase tracking-wider text-ink/45 font-semibold">
          {def.title}
        </div>
        <p className="mt-2 text-[13.5px] text-ink/60">{def.prompt}</p>
        <h2 className="mt-4 text-[20px] md:text-[22px] font-serif italic text-ink leading-snug">
          {q.text}
        </h2>
      </div>

      {/* Answers */}
      <div className="mt-6 space-y-2">
        {def.answers.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => onAnswer(a.value)}
            className="w-full text-start rounded-2xl border border-ink/12 hover:border-[#0E8A6B] hover:bg-[#0E8A6B]/5 transition px-4 py-3.5 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 shrink-0 rounded-full bg-ink/5 inline-flex items-center justify-center text-[11px] font-bold tabular-nums text-ink/65">
                {a.value}
              </span>
              <span className="text-[15px] text-ink">{a.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer disclaimer */}
      <p className="mt-8 text-[11.5px] text-ink/45 leading-relaxed">
        {lang === "ar"
          ? "هذا فحص ذاتي عام، ليس تشخيصاً. التشخيص يأتي من مختص فقط."
          : "This is a general self-screen, not a diagnosis. Only a clinician can diagnose."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 3a — Crisis flag (PHQ-9 Q9 ≥ 1)
// ─────────────────────────────────────────────────────────────────

function CrisisPhase({
  phase, therapists, onContinue,
}: {
  phase: Extract<Phase, { kind: "crisis" }>;
  therapists: Therapist[];
  onContinue: () => void;
}) {
  const lang = phase.lang;
  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6 md:py-8">
      <div className="rounded-2xl bg-[#C23F6C]/8 border border-[#C23F6C]/30 p-5 md:p-6">
        <div className="inline-flex items-center gap-2 text-[#C23F6C] font-semibold">
          <AlertTriangle size={18} />
          <span>{lang === "ar" ? "خذ هذه الخطوة الأولى" : "Take this first step"}</span>
        </div>
        <p className="mt-3 text-[15px] text-ink leading-relaxed">
          {lang === "ar"
            ? "إجابتك على السؤال الأخير (أفكار بإيذاء نفسك أو الموت) مهمة. ما عليك أن تتعامل مع هذا لوحدك. التواصل مع شخص الآن — حتى مكالمة قصيرة — يمكن أن يحدث فرقاً حقيقياً."
            : "Your answer to the last question (thoughts of self-harm or death) matters. You don't have to carry this alone. Reaching out right now — even a short call — can genuinely make a difference."}
        </p>
        <p className="mt-3 text-[14px] text-ink/85 leading-relaxed">
          {lang === "ar"
            ? "إذا كنت في خطر فوري، اتصل بـ 911 (الطوارئ في الأردن) أو اذهب لأقرب قسم طوارئ."
            : "If you're in immediate danger, call 911 (Jordan emergency) or go to the nearest hospital emergency department."}
        </p>
      </div>

      {therapists.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[14px] font-semibold text-ink mb-2">
            {lang === "ar" ? "موارد فورية في الأردن" : "Immediate resources in Jordan"}
          </h3>
          <div className="space-y-2">
            {therapists.map((t) => <TherapistCard key={t.id} t={t} lang={lang} />)}
          </div>
        </div>
      )}
      {therapists.length === 0 && (
        <div className="mt-6 rounded-2xl border border-ink/10 px-4 py-3 text-[13px] text-ink/65">
          {lang === "ar"
            ? "اتصل بـ 911 (طوارئ الأردن) فوراً، أو اذهب لأقرب مستشفى."
            : "Call 911 (Jordan emergency) immediately, or go to the nearest hospital."}
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="mt-8 w-full h-12 rounded-full bg-ink text-bg font-medium text-[14.5px] active:scale-[0.99]"
      >
        {lang === "ar" ? "متابعة" : "Continue to your full result"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 3b — Result page
// ─────────────────────────────────────────────────────────────────

function ResultPhase({
  phase, therapists, onClose,
}: {
  phase: Extract<Phase, { kind: "result" }>;
  therapists: Therapist[];
  onClose: () => void;
}) {
  const def = getScreen(phase.screen, phase.lang);
  const range = def.severityRanges.find((r) => r.severity === phase.severity);
  const lang = phase.lang;
  const totalMax = phase.screen === "PHQ-9" ? 27 : 21;

  const tierColor = (() => {
    if (phase.severity === "minimal" || phase.severity === "mild") return "#0E8A6B"; // green
    if (phase.severity === "moderate") return "#E8743B"; // amber
    return "#C23F6C"; // rose for moderately_severe + severe
  })();

  const severityLabel = (() => {
    const map = lang === "ar" ? {
      minimal: "بسيط",
      mild: "خفيف",
      moderate: "متوسط",
      moderately_severe: "متوسط-شديد",
      severe: "شديد",
    } : {
      minimal: "Minimal",
      mild: "Mild",
      moderate: "Moderate",
      moderately_severe: "Moderately severe",
      severe: "Severe",
    };
    return map[phase.severity];
  })();

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6 md:py-8">
      {/* Score card */}
      <div
        className="rounded-2xl p-5 md:p-6 text-white"
        style={{ background: `linear-gradient(135deg, ${tierColor} 0%, ${tierColor}cc 100%)` }}
      >
        <div className="text-[11px] uppercase tracking-wider opacity-90 font-semibold">
          {def.title}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-bold text-5xl md:text-6xl tabular-nums">{phase.score}</span>
          <span className="text-[14px] opacity-85 tabular-nums">/ {totalMax}</span>
        </div>
        <div className="mt-2 text-[14.5px] font-semibold">
          {severityLabel}
        </div>
      </div>

      {/* "Not a diagnosis" — mandatory, large */}
      <div className="mt-5 rounded-2xl bg-ink/4 border border-ink/10 p-4 md:p-5">
        <div className="text-[13px] font-semibold text-ink mb-1">
          {lang === "ar" ? "هذا فحص، ليس تشخيصاً" : "This is a screen, not a diagnosis"}
        </div>
        <p className="text-[13.5px] text-ink/75 leading-relaxed">
          {lang === "ar"
            ? "لا أحد — لا أنا، ولا تطبيق، ولا اختبار قصير — يمكنه تشخيصك. التشخيص الحقيقي يأتي من مختص في الصحة النفسية بعد محادثة كاملة. ما تراه هنا نقطة بداية، ليست خاتمة."
            : "Nobody — not me, not an app, not a short questionnaire — can diagnose you. A real diagnosis comes from a mental-health professional after a full conversation. What you see here is a starting point, not a conclusion."}
        </p>
      </div>

      {/* Severity-tier summary */}
      {range && (
        <div className="mt-5">
          <h3 className="text-[14px] font-semibold text-ink mb-2">
            {lang === "ar" ? "ماذا تعني هذه الدرجة" : "What this score means"}
          </h3>
          <p className="text-[14px] text-ink/80 leading-relaxed">
            {range.summary}
          </p>
        </div>
      )}

      {/* Therapists for this severity */}
      <div className="mt-6">
        <h3 className="text-[14px] font-semibold text-ink mb-2">
          {lang === "ar" ? "خيارات في الأردن" : "Options in Jordan"}
        </h3>
        {therapists.length > 0 ? (
          <div className="space-y-2">
            {therapists.map((t) => <TherapistCard key={t.id} t={t} lang={lang} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-ink/10 px-4 py-3 text-[13px] text-ink/65 leading-relaxed">
            {lang === "ar"
              ? "لا يوجد لدينا مزود مُتحقق منه لهذا المستوى بعد. الخطوات الموثوقة دائماً: اطلب من طبيبك العام إحالة، أو ابحث عن مستشار جامعي معتمد، أو اتصل بـ 911 إذا كنت في خطر فوري."
              : "I don't have a verified provider for this range yet. Reliable next steps: ask your general physician for a referral, contact your university's accredited counselor, or call 911 if you're in immediate danger."}
          </div>
        )}
      </div>

      {/* Source citation */}
      <p className="mt-8 text-[11.5px] text-ink/45 leading-relaxed">
        {def.source}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="mt-6 w-full h-12 rounded-full bg-ink text-bg font-medium text-[14.5px] inline-flex items-center justify-center gap-2 active:scale-[0.99]"
      >
        <Check size={16} />
        {lang === "ar" ? "تم — رجوع" : "Done — back to chat"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Therapist card — used in both crisis + result phases
// ─────────────────────────────────────────────────────────────────

function TherapistCard({ t, lang }: { t: Therapist; lang: ScreenLang }) {
  const isAr = lang === "ar";
  return (
    <div className="rounded-2xl border border-ink/10 p-4 hover:border-ink/25 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink text-[14.5px]">{t.name}</div>
          <div className="text-[12px] text-ink/55 mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
            <span className="capitalize">{t.kind.replace("_", " ")}</span>
            {t.city && <><span>·</span><span>{t.city}</span></>}
            {t.isFree && <><span>·</span><span className="text-[#0E8A6B] font-semibold">{isAr ? "مجاناً" : "Free"}</span></>}
            {t.isSlidingScale && <><span>·</span><span>{isAr ? "تكلفة مرنة" : "Sliding scale"}</span></>}
          </div>
          <p className="mt-2 text-[13px] text-ink/75 leading-relaxed">{t.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {t.phone && (
          <a
            href={`tel:${t.phone.replace(/\s/g, "")}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink/5 hover:bg-ink/10 text-[12.5px] text-ink"
          >
            <Phone size={12} />
            {t.phone}
          </a>
        )}
        {t.url && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink/5 hover:bg-ink/10 text-[12.5px] text-ink"
          >
            <ExternalLink size={12} />
            {isAr ? "الموقع" : "Website"}
          </a>
        )}
      </div>
    </div>
  );
}
