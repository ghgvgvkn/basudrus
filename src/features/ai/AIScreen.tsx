/**
 * AIScreen — two modes.
 *
 * 1) **Hero** (empty state, iteration 3):
 *    Two oversized persona cards side-by-side — Tony Starrk (violet, neural
 *    bloom) and Sherlock (teal, liquid wave). Each card has its own live
 *    Three.js artifact rendered as a still, a rotating subject ribbon,
 *    and a giant ask input sitting below. Picking a persona + typing
 *    sends the first message and collapses into the stream view.
 *
 * 2) **Stream** (once there are messages):
 *    Standard chat — user bubbles right, AI messages rendered with a
 *    per-message 3D artifact hero (palette from persona, geometry
 *    from inferred subject), plus the composer pinned to the bottom.
 *
 * The active persona is sticky once chosen; tapping the other card
 * mid-stream starts a fresh thread (confirmed via a soft swap
 * animation — no modal).
 *
 * Quota: free tier = 30/day. Composer disables at 0 and routes to
 * Pro. Pro shows an ∞ chip.
 *
 * Live port:
 *   Swap `fakeReply()` for a streaming call to features/ai/useAI.ts.
 *   The response shape already matches (role/body/subject/artifact).
 */
import {
  useEffect, useRef, useState,
  type ChangeEvent, type KeyboardEvent,
} from "react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import type { AIMessage, AIPersona, AISubject } from "@/shared/types";
import { fallbackGradient, inferSubject } from "./messageBg";
import { StudyPlanArtifact } from "./studyPlanArtifact";
import { ProfessorEmailArtifact } from "./professorEmailArtifact";
import { RelationshipMessageArtifact } from "./relationshipMessageArtifact";
import { CvArtifact } from "./cvArtifact";
import { TutorMessageBody } from "./TutorMessageBody";
import { useStreamingAI, type ChatMsg } from "./useStreamingAI";
import { compressImage } from "./compressImage";
import { parseQuickReplies } from "./parseQuickReplies";
import { parseStudyPlan } from "./parseStudyPlan";
import { parseProfessorEmail } from "./parseProfessorEmail";
import { parseRelationshipMessage } from "./parseRelationshipMessage";
import { parseCv } from "./parseCv";
import { useSavedMessages } from "./useSavedMessages";
import { useStreak, MILESTONES, type MilestoneEvent } from "./useStreak";
import { paletteFor } from "./subjectPalette";
import { useTutorMemory } from "./useTutorMemory";
import { decideRouting } from "./personaRouting";
import { MentalHealthScreenModal } from "./MentalHealthScreenModal";
import { StudySessionModal, getSessionContext, getBannerText, type SessionPhase } from "./StudySessionModal";
import {
  Infinity as InfinityIcon, ArrowUp, Sparkles, Brain, Heart,
  FileText, X, Plus, Bookmark, BookmarkCheck,
  Lightbulb, BookOpen, ListChecks, Flame, Menu,
} from "lucide-react";
import { HistorySidebar } from "./HistorySidebar";
import { fetchSessionById, type SessionListItem, type StudyPlanListItem } from "./useAIHistory";
import { FeedbackRow } from "./FeedbackRow";
import { useMemoryHint } from "./useMemoryHint";
import { ThinkingStatus, type ThinkingAttachmentKind } from "./ThinkingStatus";
import { friendlyProducer } from "./pdfMetaPeek";
import { ModelPicker } from "./ModelPicker";

// "auto" is a NEW client-side option that tells the API to pick the
// right teaching mode based on the message. The server treats it
// (in api/ai/tutor.ts buildModeBlock) as "look at the prompt and
// decide". The three legacy modes are preserved unchanged so any
// user who has explicitly picked one still gets the same behavior.
type TutorMode = "auto" | "homework_help" | "study_mode" | "homework_helper";

const OMAR_PROMPTS = [
  "Explain photosynthesis like I'm five",
  "Build me a 5-day plan for finals",
  "Solve ∫ x·sin(x) dx step by step",
  "Debug my React useEffect",
];
const NOOR_PROMPTS = [
  "I can't focus today",
  "I'm anxious about tomorrow's exam",
  "Help me wind down",
  "I feel stuck",
];

/**
 * AIScreen props (both optional — Bas Udrus's Shell passes neither):
 *
 * - `headerEnd` — extra controls appended to the right side of the
 *   top header row, after the Go Pro button / QuotaChip. The AI-only
 *   site (ai-app) uses this to place its Settings cog inline next to
 *   the usage indicator instead of as a free-floating overlay.
 *
 * - `fillViewport` — when true, AIScreen takes the FULL dynamic
 *   viewport height. The default `calc(100dvh - 56/64px)` reserves
 *   space for Bas Udrus's shell chrome (top bar on md+, bottom nav
 *   on mobile). ai-app has no shell chrome, so it would otherwise
 *   leave that subtracted height as visible empty space below the
 *   composer. Setting fillViewport closes the gap so the composer
 *   sits at the real viewport bottom.
 */
export function AIScreen({
  headerEnd,
  fillViewport = false,
}: { headerEnd?: React.ReactNode; fillViewport?: boolean } = {}) {
  const { aiPrefill, setAIPrefill, subscription, consumeAIMessage, setScreen, profile } = useApp();
  const { dir, lang } = useLocale();

  const [persona, setPersona] = useState<AIPersona>("omar");
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  // Tutor mode for Tony Starrk: "homework_help" (strict Socratic, default),
  // "study_mode" (proactive teaching), or "homework_helper" (guided
  // walkthrough — student writes every line, AI confirms each step).
  // Sent to /api/ai/tutor as `mode`. Sherlock doesn't use this.
  // Default to "auto" so the student feels like the AI picks the
  // right approach for each question. They can still override per
  // session by tapping Hints / Teach / Walkthrough.
  const [tutorMode, setTutorMode] = useState<TutorMode>("auto");
  const streamRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Real Anthropic-backed streaming. partial holds the in-flight
  // assistant text — we render it as the last message live, then
  // commit to `messages` when the stream finishes.
  const ai = useStreamingAI();
  const isThinking = ai.loading;
  // Bookmarked AI replies — drives the filled/empty state of the
  // bookmark icon on AI bubbles. Loads once on mount via Supabase
  // (own-only RLS), updates optimistically on toggle.
  const saved = useSavedMessages();
  // Daily streak tracker — bumps on first AI message of each UTC day,
  // surfaces a celebration toast on milestone tiers (3, 7, 14, 30,
  // 60, 100, 365). Variable rewards per tier so the same milestone
  // never feels canned. State persists in Supabase (own-only RLS).
  const streak = useStreak();
  const [milestone, setMilestone] = useState<MilestoneEvent | null>(null);
  // Mental-health self-screen modal (Day 13). Open from the Sherlock
  // empty state or via a "Take a check-in" quick reply. After the
  // student completes a screen, we push a system notice into the
  // chat with their score so Sherlock can respond contextually on the
  // next message. Crisis-flagged results route through Day 8's
  // force-switch flow (already in place via wellbeing.ts CRISIS_MODE).
  const [screenOpen, setScreenOpen] = useState(false);
  // Day 18 — solo focus session state. studySession holds the live
  // phase (or null when no session is running). When non-null + active,
  // we show a small banner at top and pass session context to the AI
  // on each message send so Tony Starrk's prompt switches to focus mode.
  const [studyModalOpen, setStudyModalOpen] = useState(false);
  const [studySession, setStudySession] = useState<SessionPhase | null>(null);
  // History sidebar — slides in from the left, shows past chats, plans,
  // and the memory entry. Closed by default; opened via the hamburger
  // icon in the header. Mobile-first drawer; on desktop it's the same
  // drawer at a sensible max-width.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Day 18 banner re-render tick. The in-session banner reads
  // `getBannerText(studySession)` which calls Date.now() to compute
  // "X min in." Without a periodic re-render, the text was frozen at
  // session start and only refreshed when studySession state changed
  // (phase transitions, pause/resume). Result: banner said "0 min in"
  // for the full 25-minute focus block. We tick once every 30s while
  // a session is active so the elapsed minute counter advances in
  // near-real-time without burning render cycles when nothing is
  // happening. Cleared automatically when the session ends.
  const [, setBannerTick] = useState(0);
  useEffect(() => {
    if (studySession?.kind !== "active") return;
    const id = setInterval(() => setBannerTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [studySession?.kind]);
  // Day 18 — last phase KIND we surfaced a system notice for, tracked
  // in a ref so we only push the start / end notice ONCE per transition,
  // not every time the modal re-renders. Without this, the inline arrow
  // passed as onPhaseChange caused a runaway loop: setMessages →
  // re-render → new arrow ref → modal's [onPhaseChange] effect re-fires
  // → another setMessages, etc.
  const lastSessionKindRef = useRef<string | null>(null);

  // Bas Udros tutor: when AIScreen unmounts (user navigates to a
  // different screen, signs out, etc.) close the active session so
  // post-session analysis runs in the background. Subject changes
  // during the same mount are handled inside useStreamingAI itself —
  // it auto-closes the previous session and opens a fresh one.
  // Stable ref so the cleanup picks up the latest endActiveSession
  // without retriggering on every render.
  const endSessionRef = useRef(ai.endActiveSession);
  endSessionRef.current = ai.endActiveSession;
  useEffect(() => {
    return () => {
      try { endSessionRef.current(); } catch { /* swallow — never block unmount */ }
    };
  }, []);

  // Consume prefill from command palette.
  useEffect(() => {
    if (aiPrefill) {
      setDraft(aiPrefill);
      setAIPrefill("");
    }
  }, [aiPrefill, setAIPrefill]);

  // Autoscroll on new messages.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const over = subscription.tier === "free" && subscription.aiQuota <= 0;

  const sendWith = async (body: string, file: File | null) => {
    if (!body && !file) return;
    if (over) { setScreen("subscription"); return; }
    if (!consumeAIMessage()) { setScreen("subscription"); return; }

    // ── Persona routing — three-way decision ──
    // Three cases handled by decideRouting(message, currentPersona):
    //
    //   1. CRISIS (force_crisis):
    //      Message contains genuine crisis language — suicide ideation,
    //      self-harm, "I want to die" / "بدي أموت". We FORCE-SWITCH to
    //      Sherlock regardless of the user's pick. No suggestion card, no
    //      opt-in — direct to Sherlock's CRISIS_MODE. The bias toward
    //      action is correct here: the cost of missing a crisis routing
    //      far outweighs the cost of one math question going to Sherlock.
    //      We ALSO flip the global PersonaToggle so subsequent messages
    //      keep going to Sherlock unless the user manually switches back.
    //
    //   2. SUGGEST (suggest):
    //      Soft signal that the other persona might be a better fit.
    //      Send THIS message to the user's chosen persona, then append
    //      a SwitchSuggestionCard with two clear buttons. User chooses.
    //
    //   3. STAY (stay):
    //      No signal — send to the chosen persona, no card.
    //
    // The classifier is bilingual (English + Arabic). See
    // ./personaRouting.ts for the full pattern table.
    const routing = decideRouting(body, persona);
    const isForceCrisis = routing.kind === "force_crisis";
    const activePersona: AIPersona = isForceCrisis ? "noor" : persona;
    const shouldSuggestSwitch = routing.kind === "suggest";
    const inferred = routing.kind === "suggest" ? routing.target : activePersona;

    // Force-switch case: flip the global toggle so the conversation
    // continues with Sherlock on the next turn too. The user can always
    // manually switch back via PersonaToggle. The in-chat notice that
    // surfaces this switch to the student is pushed below as a system
    // "crisis-bridge" message — see the setMessages call further down.
    if (isForceCrisis && persona !== "noor") {
      setPersona("noor");
    }

    const subject = inferSubject(body, activePersona);

    // ── File classification (image vs PDF) using mime + extension ──
    // We can't trust file.type alone — it's empty for some browser
    // drag-drop sources and "application/octet-stream" for others
    // (notably some Android keyboards). Use both: mime first, then
    // file extension as fallback. HEIC is detected separately so we
    // can surface a specific friendly error (browsers can't decode
    // HEIC; the user needs to convert or take a screenshot instead).
    const fileLower = file ? file.name.toLowerCase() : "";
    const looksLikeImage = !!file && (
      file.type.startsWith("image/")
      || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(fileLower)
    );
    const looksLikeHeic = !!file && (
      file.type === "image/heic" || file.type === "image/heif"
      || /\.(heic|heif)$/i.test(fileLower)
    );
    const looksLikePdf = !!file && (
      file.type === "application/pdf"
      || /\.pdf$/i.test(fileLower)
    );

    // ── Image compression (if the file is an image) ──
    // We compress on the client to a JPEG ≤700 KB so the request
    // body stays small AND the user sees the same thumbnail
    // (dataUrl) we send to the AI.
    //
    // CRITICAL: failures are no longer silent. Previously, a HEIC
    // file from iPhone would fail decode (Chrome/Firefox/Edge can't
    // render HEIC), compressImage threw, we swallowed the error,
    // and the message went through with NO image data — the AI
    // would say "I don't see any image" and the student would
    // (correctly!) think the upload was broken. Now we track the
    // failure reason and surface it as a system notice in the chat.
    let imagePayload: { base64: string; mediaType: "image/jpeg"; dataUrl: string } | null = null;
    let imageFailReason: string | null = null;
    if (file && looksLikeImage) {
      // Reject HEIC up-front with a specific message — most browsers
      // can't decode it, so even attempting compression wastes time.
      if (looksLikeHeic) {
        imageFailReason = "HEIC isn't supported by most browsers. Take a screenshot of the photo (long-press → screenshot), or change your iPhone's camera setting to JPEG (Settings → Camera → Formats → Most Compatible).";
      } else {
        try {
          const compressed = await compressImage(file);
          imagePayload = {
            base64: compressed.base64,
            mediaType: compressed.mediaType,
            dataUrl: compressed.dataUrl,
          };
        } catch (e) {
          // Common causes: unsupported codec, corrupted file, OOM on
          // low-end phones. Show the user something they can act on.
          if (import.meta.env.DEV) console.warn("[upload] compress failed:", e);
          imageFailReason = "Couldn't read this image — please try a JPEG or PNG (under 5 MB), or send a screenshot instead.";
        }
      }
    }

    // ── PDF: read as base64, send directly to Anthropic ──
    // Architecture decision (2026-05-08): we no longer parse PDFs
    // client-side. The previous pdfjs-based extraction crashed on
    // iOS Safari with module-worker iterable issues — chasing that
    // through pdfjs internals was a moving target. Instead we hand
    // the raw PDF bytes to Anthropic which reads the document
    // natively (text + figures + scans via OCR). Same end result
    // for the student, no parser to break.
    //
    // Cap: 1 MB raw client-side. Larger PDFs surface a friendly
    // "split it or send a screenshot" message — covers ~95% of real
    // homework / chapter / past-paper uploads. Long textbooks need
    // to be split anyway because Claude's context window benefits
    // from focused chunks.
    let pdfPayload: {
      base64: string;
      name: string;
      sizeBytes: number;
      /** Lightweight metadata peeked from raw bytes — populated when
       *  the file successfully parses; all fields null otherwise. */
      meta?: { pageCount: number | null; title: string | null; author: string | null; producer: string | null; creator: string | null };
    } | null = null;
    let documentFailReason: string | null = null;
    if (file && looksLikePdf) {
      try {
        const mod = await import("./readPdfAsBase64");
        const result = await mod.readPdfAsBase64(file);
        pdfPayload = {
          base64: result.base64,
          name: result.filename,
          sizeBytes: result.sizeBytes,
          meta: result.meta,
        };
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[upload] pdf read failed:", e);
        const errName = e instanceof Error ? e.name : "";
        if (errName === "PdfTooLargeError") {
          const mb = (file.size / (1024 * 1024)).toFixed(1);
          documentFailReason = `This PDF is ${mb} MB — over the 1 MB upload limit. Split it into smaller chapters, or send a screenshot of the page you want help with.`;
        } else {
          const errMsg = e instanceof Error ? (e.message || "").slice(0, 120) : "";
          const technical = errName || errMsg ? `\n\n[Technical: ${errName}${errMsg ? ` — ${errMsg}` : ""}]` : "";
          documentFailReason = `Couldn't read this PDF — try a different one or send a screenshot of the page.${technical}`;
        }
      }
    }
    // Plain-text doc context (.txt / .doc) is no longer wired here —
    // PDFs go through pdfBase64, images through imagePayload. If we
    // add .txt support later, set these locals; for now they stay
    // undefined and the API gets nothing in those fields.
    const documentTextForApi: string | undefined = undefined;
    const documentLabelForApi: string | undefined = undefined;

    // Catch-all for anything not in the supported types. The composer
    // only accepts image/*, application/pdf, .doc/.docx/.txt, but the
    // .doc/.docx/.txt path doesn't actually have client-side
    // extraction yet — surface that so the student isn't confused.
    if (file && !looksLikeImage && !looksLikePdf) {
      documentFailReason = `${file.name} isn't a supported file type yet. Use a PDF, JPEG, PNG, or paste the text directly.`;
    }

    const userMsg: AIMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      persona: activePersona,
      body: body || (file ? `Sent ${file.name}` : ""),
      subject,
      createdAt: new Date().toISOString(),
      attachment: file
        ? {
            name: file.name,
            kind: fileKind(file.name),
            // For images, store the compressed dataUrl so the user
            // bubble can render a thumbnail without re-reading the
            // File. PDFs no longer carry pdfMeta (page count etc.)
            // because we send the raw bytes to Anthropic instead of
            // parsing client-side — the user bubble shows a simpler
            // filename + size card now.
            url: imagePayload?.dataUrl,
            pdfMeta: pdfPayload
              ? {
                  // Page count comes from pdfMetaPeek's byte-level
                  // regex (no parser, no iOS Safari crash). When the
                  // peek can't find a Pages dict, we keep the legacy
                  // sentinel value of 0 so the bubble falls back to
                  // showing file size only — same as before this
                  // upgrade. characterCount stores the raw byte size
                  // so the size-label render below still works.
                  pageCount: pdfPayload.meta?.pageCount ?? 0,
                  characterCount: pdfPayload.sizeBytes,
                  truncated: false,
                  title: pdfPayload.meta?.title ?? null,
                  author: pdfPayload.meta?.author ?? null,
                  producer: pdfPayload.meta?.producer
                    // Map raw producer ("Microsoft Word 2021 for Mac")
                    // to a friendly label ("Microsoft Word") at the
                    // origin point so the renderer stays presentational.
                    ? friendlyProducer(pdfPayload.meta.producer)
                    : null,
                }
              : undefined,
          }
        : undefined,
    };
    // Push the user message immediately. Then any system notices
    // for: (a) crisis force-switch bridge, (b) upload failures the
    // student needs to know about (HEIC rejected, scanned PDF, etc.).
    // Failure notices render as a centered pill via SystemNotice.
    const uploadFailMsg = imageFailReason || documentFailReason;
    setMessages((m) => {
      const next = [...m, userMsg];
      if (isForceCrisis) {
        next.push({
          id: `crisis-bridge-${Date.now()}`,
          role: "system",
          persona: "noor",
          body: "Switched to Sherlock — she handles the heavier stuff. If this was about something else, tap Tony Starrk at the top to switch back. Either is okay.",
          createdAt: new Date().toISOString(),
        });
      }
      if (uploadFailMsg) {
        next.push({
          id: `upload-fail-${Date.now()}`,
          role: "system",
          persona: activePersona,
          body: uploadFailMsg,
          createdAt: new Date().toISOString(),
        });
      }
      return next;
    });
    setDraft("");
    setAttachment(null);

    // If the student attached a file but it didn't process AND they
    // didn't type anything — abort the send. There's no point asking
    // the AI a blank question with no file context. The system
    // notice already told them why.
    if (uploadFailMsg && !body.trim()) {
      return;
    }

    // Build the chat history for the API — include only user/assistant
    // turns (system notices and any prior file metadata are scrubbed).
    const history: ChatMsg[] = messages
      .filter((m) => m.role === "user" || m.role === "ai")
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.body }));

    const result = await ai.send(activePersona, body, history, {
      subject,
      lang: lang === "ar" ? "ar" : "en",
      // Demo profile has nullable fields; the API just wants
      // strings or undefined, so coalesce nulls away.
      uni:   profile?.uni   ?? undefined,
      major: profile?.major ?? undefined,
      year:  profile?.year  ?? undefined,
      // Image attached this turn — backend swaps the last user
      // message into a multimodal Anthropic content block so Bas
      // Udros / Sherlock can actually see it.
      imageBase64:    imagePayload?.base64,
      imageMediaType: imagePayload?.mediaType,
      // PDF attached this turn — sent as a base64 `document` content
      // block. Anthropic reads the PDF natively (text + figures +
      // OCR for scans). Replaces the previous client-side text
      // extraction path which had pdfjs/iOS Safari issues.
      pdfBase64: pdfPayload?.base64,
      pdfName:   pdfPayload?.name,
      // documentContext stays for non-PDF text formats (.txt, .doc).
      // Currently unwired — both fields are always undefined.
      documentContext: documentTextForApi,
      documentLabel:   documentLabelForApi,
      // Tutor mode (Tony Starrk only) — homework_help / study_mode /
      // homework_helper. Sherlock ignores this.
      mode: activePersona === "omar" ? tutorMode : undefined,
      // Day 18 — when a focus session is active, pass the session
      // context so Tony Starrk's prompt switches into focus mode (more
      // structured, gently redirects off-topic, helps wrap up cleanly
      // near the end). Null when no session is active or persona
      // is Sherlock (mental-health side ignores this).
      studySession: activePersona === "omar"
        ? getSessionContext(studySession) ?? undefined
        : undefined,
    });

    if (result.ok) {
      // Strip the <<<OPTIONS>>> block out of the visible body and
      // promote the parsed options to msg.quickReplies — the bubble
      // renders them as tappable chips below the message instead of
      // making the student read the marker syntax. Both Bas Udros
      // and Sherlock are instructed (via system prompt) to emit this
      // block whenever they ask a question with 3-5 typical answers.
      // Five-stage parsing: pull off STUDY_PLAN, PROFESSOR_EMAIL,
      // RELATIONSHIP_MESSAGE, then CV blocks first (so the JSON
      // doesn't leak into the visible body), then strip <<<OPTIONS>>>
      // chips from what remains. Artifacts are typically mutually
      // exclusive on a single turn; precedence if multiple appear:
      // plan > email > relationship message > cv. (Most "load-bearing"
      // output wins; CV is last because it's the longest and most
      // self-contained — anything else is more conversational.)
      const planParsed = parseStudyPlan(result.assistant);
      const emailParsed = parseProfessorEmail(planParsed.body);
      const relMsgParsed = parseRelationshipMessage(emailParsed.body);
      const cvParsed = parseCv(relMsgParsed.body);
      const parsed = parseQuickReplies(cvParsed.body);
      const aiMsg: AIMessage = {
        id: `a-${Date.now()}`,
        role: "ai",
        persona: activePersona,
        body: parsed.body,
        quickReplies: parsed.quickReplies.length > 0 ? parsed.quickReplies : undefined,
        subject,
        createdAt: new Date().toISOString(),
        // Attach whichever artifact was emitted this turn. Precedence:
        // plan > email > relationship message > cv. Mutually
        // exclusive in practice; precedence only matters if the AI
        // somehow emitted multiple, which the prompts forbid.
        artifact:
          planParsed.artifact
          ?? emailParsed.artifact
          ?? relMsgParsed.artifact
          ?? cvParsed.artifact
          ?? undefined,
      };
      // Append the AI response, then optionally the switch-suggestion
      // card. The card lets the user EXPLICITLY decide whether to
      // switch personas — never auto-forced. PersonaToggle at the top
      // remains always available for manual changes too.
      setMessages((m) => {
        const next = [...m, aiMsg];
        if (shouldSuggestSwitch) {
          next.push({
            id: `sug-${Date.now()}`,
            role: "system",
            persona: activePersona,
            body: inferred === "noor"
              ? "This sounded more like an emotional / motivation question. Want to switch to Sherlock?"
              : "This sounded more like a study / homework question. Want to switch to Tony Starrk?",
            createdAt: new Date().toISOString(),
            switchSuggestion: { suggested: inferred, current: activePersona },
          });
        }
        return next;
      });
      // Daily-streak bump — fire after a successful AI exchange so we
      // only reward real engagement (not failed sends or aborted
      // streams). Idempotent within a UTC day, so users who chat a lot
      // don't multi-bump. If today's bump crosses an unseen milestone
      // tier, we surface the celebration toast.
      void streak.recordToday().then((event) => {
        if (event) setMilestone(event);
      });
    } else {
      // User-initiated cancel — silently drop the in-flight stream
      // without surfacing an error bubble. The streamed partial (if
      // any) is already wiped by the abort() call in the hook; there's
      // nothing to show, and an error message would be confusing
      // ("I cancelled, why is it telling me there was an error?").
      if (result.reason === "aborted") {
        return;
      }
      // Surface real errors visibly. Where possible, include the
      // server's actual message (e.g. "Service temporarily
      // unavailable" → env vars missing on Vercel). Generic lines
      // are reserved for cases where we know the cause.
      const fallback =
        result.reason === "auth"
          ? "Sign in to use the AI."
          : result.reason === "daily_limit" || result.reason === "hourly_limit"
          ? "You've hit the AI rate limit — try again later or upgrade."
          : result.reason === "network"
          ? "Couldn't reach the AI server. Check your connection."
          : "Couldn't reach the AI. Try again in a moment.";
      const body = result.message
        ? `${fallback}${result.message && result.message !== fallback ? ` (${result.message})` : ""}`
        : fallback;
      const err: AIMessage = {
        id: `err-${Date.now()}`,
        role: "system",
        persona: activePersona,
        body,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, err]);
    }
  };

  const send = () => {
    // Drop send if AI is still streaming — matches the disabled-button
    // state in ComposerRow. Without this, Enter-key submits would
    // bypass the visual disabled state and get rate-limited silently
    // (audit P1 #2).
    if (isThinking) return;
    void sendWith(draft.trim(), attachment);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setAttachment(f);
    e.target.value = "";
  };

  return (
    <div
      className={
        "relative flex flex-col " +
        (fillViewport
          ? "h-dvh"
          // Mobile reserves 64px for MobileNav; tablet (md) reserves
          // 56px (legacy offset). Desktop (lg+) has no bottom nav and
          // no top bar in Shell — only a fixed left sidebar — so the
          // subtraction created an empty strip below the composer.
          // lg:h-dvh closes that gap so the typing bar sits at the
          // real viewport bottom on desktop, matching the AI-only site.
          : "h-[calc(100dvh-64px)] md:h-[calc(100dvh-56px)] lg:h-dvh")
      }
      dir={dir}
    >
      {/* Mental-health self-screen modal (Day 13). Mounts at top so
          its own fixed-position layer doesn't fight with the chat
          tree. After a result is saved we (a) flip persona to Sherlock
          if it isn't already, and (b) push a single system notice
          into the chat with the score so Sherlock's next reply has
          context. We don't auto-send a message — the student decides
          when / whether to share more. */}
      {screenOpen && (
        <MentalHealthScreenModal
          initialLang={lang === "ar" ? "ar" : "en"}
          onClose={() => setScreenOpen(false)}
          onResultSaved={(r) => {
            // Always switch to Sherlock — this is mental-health territory,
            // any follow-up should go through her flow.
            if (persona !== "noor") setPersona("noor");
            // Drop a system notice with the result. Severity is in
            // English to match prompt routing; the AI handles
            // localization in its reply.
            const summary = r.flaggedSelfHarm
              ? `Took ${r.screen} · score ${r.score} · severity ${r.severity} · self-harm flag set`
              : `Took ${r.screen} · score ${r.score} · severity ${r.severity}`;
            setMessages((m) => [
              ...m,
              {
                id: `mh-${Date.now()}`,
                role: "system",
                persona: "noor",
                body: summary,
                createdAt: new Date().toISOString(),
              },
            ]);
          }}
        />
      )}
      {/* Day 18 — focus-session modal. We persist the active phase in
          AIScreen state so the modal can be closed/reopened without
          losing the session in progress. The modal pushes a system
          notice into the chat at start + end so Tony Starrk's next reply
          has context, plus passes session context on every send. */}
      {studyModalOpen && (
        <StudySessionModal
          initialPhase={studySession ?? undefined}
          onClose={() => {
            // Reset to setup phase if the user is closing from the
            // summary screen — otherwise reopening the modal would
            // drop them back into the old summary forever (the
            // session-ended state never gets cleared).
            if (studySession?.kind === "summary") {
              setStudySession(null);
              lastSessionKindRef.current = null;
            }
            setStudyModalOpen(false);
          }}
          onPhaseChange={(p) => {
            // Compare against the LAST kind we acted on (ref-tracked),
            // NOT the latest studySession state — closure-read state can
            // be stale within the same render pass and the inline-arrow
            // recreation causes the modal effect to re-fire repeatedly.
            // The ref guarantees we only push each notice ONCE per
            // transition.
            const oldKind = lastSessionKindRef.current;
            const newKind = p?.kind ?? null;
            lastSessionKindRef.current = newKind;
            setStudySession(p);
            // Start notice — first transition into "active".
            if (oldKind !== "active" && newKind === "active" && p?.kind === "active") {
              setMessages((m) => [
                ...m,
                {
                  id: `study-start-${Date.now()}`,
                  role: "system",
                  persona: "omar",
                  body: `Focus session started — ${p.subject}: ${p.goal} · ${p.totalDurationMin} min`,
                  createdAt: new Date().toISOString(),
                },
              ]);
            }
            // End notice — first transition into "summary".
            if (oldKind !== "summary" && newKind === "summary" && p?.kind === "summary") {
              setMessages((m) => [
                ...m,
                {
                  id: `study-end-${Date.now()}`,
                  role: "system",
                  persona: "omar",
                  body: `Focus session ended — ${p.totalElapsedMin} min on ${p.subject} · ${p.focusBlocksCompleted} focus block(s) completed`,
                  createdAt: new Date().toISOString(),
                },
              ]);
            }
          }}
        />
      )}
      {/* Header — hamburger opens the history sidebar; persona toggle
          is always visible so users can manually override the auto-
          switch and the chat never feels locked to one mode. */}
      <div className="flex items-center gap-2 px-4 md:px-6 h-14 border-b border-ink/8">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Open history and memory"
          className="w-9 h-9 -ml-1 rounded-full inline-flex items-center justify-center text-ink/65 hover:text-ink hover:bg-ink/5 transition active:scale-[0.95]"
        >
          <Menu size={18} />
        </button>
        <PersonaToggle value={persona} onChange={(p) => {
          // Don't wipe the thread on manual switch — that was
          // friction. If the user wants a fresh thread they can
          // use "New chat" (history drawer, future slice).
          setPersona(p);
        }} />
        <div className="ml-auto flex items-center gap-2">
          {/* Streak chip — flame + day count. Hidden when streak is
              0 (a brand-new user on day-zero shouldn't see "0 days").
              Tappable in future iterations to open a streak modal;
              for now it's purely informational. */}
          {streak.current > 0 && (
            <StreakChip
              current={streak.current}
              longest={streak.longest}
              milestonesReached={streak.milestonesReached}
            />
          )}
          <QuotaChip />
          {subscription.tier === "free" && (
            <button
              onClick={() => setScreen("subscription")}
              className="h-8 px-3 rounded-full bg-ink text-bg text-xs font-medium hover:bg-ink/85 transition inline-flex items-center gap-1.5"
            >
              <Sparkles size={12} /> Go Pro
            </button>
          )}
          {/* Optional caller-provided slot — used by the AI-only site to
              place its Settings cog next to QuotaChip / Go Pro. Bas Udrus
              doesn't pass anything, so this is a no-op there. */}
          {headerEnd}
        </div>
      </div>

      {/* Milestone celebration — variable-reward toast that fires
          when the user crosses a never-seen-before streak tier
          (3, 7, 14, 30, 60, 100, 365). Auto-dismisses after 6
          seconds; the user can also tap to dismiss early. */}
      {milestone && (
        <MilestoneToast event={milestone} onDismiss={() => setMilestone(null)} />
      )}

      {/* Day 18 — in-session banner. Visible whenever a focus session
          is active. Tap reopens the modal (timer + actions). Hidden
          when no session is running. Shown for both personas because
          the banner is informational (the AI behavior change applies
          to Tony Starrk specifically). */}
      {getBannerText(studySession) && (
        <button
          type="button"
          onClick={() => setStudyModalOpen(true)}
          className="w-full px-4 md:px-6 py-2 border-b border-[#5B4BF5]/20 bg-[#5B4BF5]/8 hover:bg-[#5B4BF5]/12 transition text-start active:scale-[0.998]"
        >
          <div className="max-w-3xl lg:max-w-5xl mx-auto flex items-center gap-2 text-[12px] text-[#5B4BF5]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#5B4BF5] animate-pulse" />
              {getBannerText(studySession)}
            </span>
            <span className="ml-auto text-[11px] text-[#5B4BF5]/70">tap to manage →</span>
          </div>
        </button>
      )}

      {/* Body — chat stream. The empty state is just a minimal greeting
          + quick prompts; the composer sits at the bottom like any
          real chat. No more giant persona-picker box. */}
      <div ref={streamRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyChatState
            persona={persona}
            onQuick={(text) => sendWith(text, null)}
            onOpenScreen={() => setScreenOpen(true)}
            onOpenSession={() => setStudyModalOpen(true)}
          />
        ) : (
          <div className="max-w-3xl lg:max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6">
            {(() => {
              // Find the index of the LATEST AI message so we can
              // attach the always-available quick-action chips
              // ("Quiz me on this", "Make it simpler", etc.) to it
              // only. Older AI messages don't show the chips —
              // sending a new message naturally "dismisses" them
              // because a newer AI reply becomes latest. Computed
              // once per render. Streaming preview is rendered
              // separately below and has no quick-actions.
              let latestAiIdx = -1;
              for (let k = messages.length - 1; k >= 0; k--) {
                if (messages[k].role === "ai") { latestAiIdx = k; break; }
              }
              return messages.map((m, i) => {
                // For AI messages, find the most recent user message
                // before this one — used as feedback context so the
                // weekly thumbs-down review shows BOTH the prompt and
                // the bad reply. Lightweight: small linear scan, runs
                // once per render of a stable list.
                const priorUserMessageText = m.role === "ai"
                  ? (messages.slice(0, i).reverse().find((p) => p.role === "user")?.body ?? null)
                  : null;
                return (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    onSwitchPersona={setPersona}
                    onDismissSuggestion={(id) =>
                      setMessages((arr) => arr.filter((x) => x.id !== id))
                    }
                    onQuickReply={(text) => {
                      // Same path as typing + sending. The `null` second
                      // arg is the file slot — quick replies never carry
                      // an attachment.
                      void sendWith(text, null);
                    }}
                    isSaved={saved.isSaved(m.id)}
                    onToggleSave={() => { void saved.toggle(m); }}
                    priorUserMessageText={priorUserMessageText}
                    isLatestAi={i === latestAiIdx}
                  />
                );
              });
            })()}
            {/* Streaming live preview: render the partial response as
                a real assistant bubble so the user sees text flow in
                token-by-token. Once the stream finishes we commit
                the full text to `messages` and this row disappears. */}
            {isThinking && ai.partial && (
              <MessageRow
                key="streaming"
                msg={{
                  id: "streaming",
                  role: "ai",
                  persona,
                  // Strip the <<<OPTIONS>>>...<<<END_OPTIONS>>> markers
                  // from the live preview so students never see the raw
                  // tags flash on screen mid-stream. parseQuickReplies
                  // returns the original text unchanged when the block
                  // hasn't closed yet (the AI is still emitting), so
                  // the streaming feel is unaffected — only the visual
                  // flash is hidden once the closer arrives.
                  body: parseQuickReplies(parseCv(parseRelationshipMessage(parseProfessorEmail(parseStudyPlan(ai.partial).body).body).body).body).body,
                  createdAt: new Date().toISOString(),
                }}
              />
            )}
            {isThinking && !ai.partial && (() => {
              // Derive the most recent user message + its attachment
              // kind so the thinking indicator can adapt its phrase
              // ("Looking at your image...", "Reading your PDF...",
              // "Checking sources...", etc.). Purely visual — no
              // change to the request/response logic.
              const lastUser = [...messages].reverse().find((m) => m.role === "user");
              const lastUserText = lastUser?.body ?? "";
              const att: ThinkingAttachmentKind = lastUser?.attachment?.kind ?? null;
              return (
                <ThinkingStatus
                  persona={persona}
                  attachment={att}
                  userText={lastUserText}
                />
              );
            })()}
          </div>
        )}
      </div>

      {/* Composer — always visible, not just in stream mode. This is
          the "open chat by default" behaviour from the earlier design.
          Tightened vertical density: smaller py + mb spacing + a
          shorter disclaimer line so the typing area takes less of the
          viewport on mobile. Tap targets stay at 40 px (iOS minimum)
          so we don't sacrifice accessibility for compactness. */}
      <div className="border-t border-ink/8 bg-bg">
        <div className="max-w-3xl lg:max-w-5xl mx-auto px-4 md:px-6 py-2">
          {/* Tutor-mode picker (Tony Starrk only). Four modes now:
              · Auto — Tony Starrk picks the right approach per question (default)
              · Hints — strict Socratic
              · Teach — proactive concept teaching
              · Walkthrough — guided step-by-step
              Sits to the LEFT of the model picker on the same row so
              the composer header reads as a unified control strip.
              Sherlock doesn't use modes so the row is empty on her side
              except for the model picker. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              {persona === "omar" && (
                <TutorModeToggle value={tutorMode} onChange={setTutorMode} />
              )}
            </div>
            <div className="shrink-0 pb-1">
              <ModelPicker
                isPro={subscription.tier === "pro"}
              />
            </div>
          </div>
          {/* Quick-action chips moved into each AI message bubble —
              rendered only on the LATEST AI reply so they auto-dismiss
              as soon as the student sends a follow-up. See the chips
              block in AIMessageView. */}
          {attachment && (
            <div className="mb-1.5 inline-flex items-center gap-2 h-8 px-3 rounded-full bg-ink/5 border border-ink/10 text-[13px]">
              <FileText size={13} className="text-ink/60" />
              <span className="truncate max-w-[200px]">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-ink/40 hover:text-ink"><X size={13} /></button>
            </div>
          )}
          <ComposerRow
            draft={draft} setDraft={setDraft}
            onKey={onKey} onSend={send}
            over={over} busy={isThinking} persona={persona}
            onPickFile={onPickFile} fileRef={fileRef}
            attachmentPresent={!!attachment}
          />
          {/* Disclaimer — single short line. Mobile shows the trimmed
              version; on a crisis Sherlock's own response carries the
              full safety message anyway, so the footer doesn't need
              to. Compact text-[10.5px] line so it doesn't add a
              perceptible row height. */}
          <p className="mt-1 text-[10.5px] text-ink/40 text-center leading-tight">
            {persona === "omar"
              ? "Tony Starrk can be wrong — check important answers."
              : "Sherlock isn't a therapist. Crisis? Call your local emergency number."}
          </p>
        </div>
      </div>

      {/* History sidebar — slide-in drawer with past chats, plans, and
          Memory access. Triggered by the hamburger in the header. */}
      <HistorySidebar
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={async (item: SessionListItem) => {
          // Resume in place: pull the session's full messages from
          // whichever table the session lives in (tutor_sessions for
          // Tony Starrk, wellbeing_sessions for Sherlock), swap them into the
          // chat view, switch the global persona toggle to match,
          // and push a system notice so the student understands what
          // happened. The next message they send will go to the
          // matching API endpoint with full history attached.
          setHistoryOpen(false);
          const full = await fetchSessionById(item.id, item.persona);
          if (!full) {
            setMessages((prev) => [
              ...prev,
              {
                id: `sys-resume-fail-${Date.now()}`,
                role: "system",
                persona,
                body: "Couldn't load that chat — it might have been deleted, or your connection blipped. Try again in a moment.",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }
          // Switch persona to match what the resumed conversation
          // belongs to. Without this, sending the next message
          // would route to the wrong endpoint and the AI would
          // respond as the wrong character.
          if (persona !== full.persona) setPersona(full.persona);
          const resumed: typeof messages = full.messages.map((m, i) => ({
            id: `resumed-${full.persona}-${full.id}-${i}-${m.ts}`,
            role: m.role === "assistant" ? "ai" : "user",
            persona: full.persona,
            body: m.content,
            createdAt: m.ts,
          }));
          const personaName = full.persona === "noor" ? "Sherlock" : "Tony Starrk";
          const subjectLabel = full.persona === "noor"
            ? "what you were working through"
            : (full.subject || "this chat");
          resumed.push({
            id: `sys-resumed-${Date.now()}`,
            role: "system",
            persona: full.persona,
            body: `Resumed your past chat with ${personaName} about ${subjectLabel}. Keep going where you left off — ${personaName} can see the full thread above.`,
            createdAt: new Date().toISOString(),
          });
          setMessages(resumed);
        }}
        onSelectPlan={(item: StudyPlanListItem) => {
          // Plan re-open is still placeholder-only — re-rendering the
          // saved markdown in the existing study-plan artifact modal
          // is a separate plumbing job and we'd rather ship that
          // fully wired in its own commit than half-ship it here.
          setHistoryOpen(false);
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-plan-${Date.now()}`,
              role: "system",
              persona,
              body: `Plan "${item.title}" — re-opening saved plans in the artifact modal is shipping next. The plan is safe in your account.`,
              createdAt: new Date().toISOString(),
            },
          ]);
        }}
      />
    </div>
  );
}

// ───────────────────────── minimal empty state ─────────────────────────

/** Open-chat empty state — personalised. Pulls a memory-driven
 *  greeting from useTutorMemory (built from streak + tutor_progress
 *  data) so a returning student sees "It's been 3 days, want to
 *  revisit calculus?" instead of the generic prompt every time.
 *  Falls back to the original generic greeting on first-time users
 *  and during initial load.
 *
 *  Memory-driven prompts get a subtle subject-palette accent (ring +
 *  text color) so "Quiz me on math" looks visually different from
 *  the generic "Build me a 5-day plan" — the personalised ones are
 *  meant to be the eye's first stop. */
function EmptyChatState({ persona, onQuick, onOpenScreen, onOpenSession }: { persona: AIPersona; onQuick: (text: string) => void; onOpenScreen?: () => void; onOpenSession?: () => void }) {
  const memory = useTutorMemory(persona);
  // Optional proactive hint — surfaces ONE high-confidence durable
  // memory ("Last time you mentioned struggling with AVL trees — want
  // to revisit?"). Null when no memory qualifies. Renders in addition
  // to the existing greeting/subline; never replaces them. Style is a
  // distinct accent card so the eye reads it as "Tony Starrk remembers" not
  // a second tagline.
  const memoryHint = useMemoryHint(persona);
  const accent = memory.recentSubject ? paletteFor(memory.recentSubject) : null;
  // The first N prompts are memory-driven; the rest are generic.
  // We track which is which to apply different styling. memory.prompts
  // is already prefixed with memory entries; we slice based on the
  // simple heuristic that personalised prompts mention a subject
  // label or "where we left off" / "warm up". Easier: anything in the
  // generic OMAR_PROMPTS / NOOR_PROMPTS list is generic; the rest is
  // memory-driven. Reads cleanly without exposing internals.
  const isMemoryDriven = (p: string) =>
    !OMAR_PROMPTS.includes(p) && !NOOR_PROMPTS.includes(p);
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-2xl w-full mx-auto px-6 text-center">
        <h1 className="font-serif italic text-3xl md:text-5xl text-ink leading-[1.1]">
          {memory.greeting}
        </h1>
        {memory.subline ? (
          <p className="mt-3 text-ink/55 text-sm md:text-base max-w-xl mx-auto leading-relaxed">
            {memory.subline}
          </p>
        ) : (
          <p className="mt-3 text-ink/55 text-sm md:text-base">
            Chatting with <span className="font-medium text-ink/80">{persona === "omar" ? "AI (Tony Starrk)" : "AI (Sherlock)"}</span>. I'll switch modes if the topic calls for it.
          </p>
        )}
        {/* Proactive memory hint — renders only when we have a high-
            confidence, recent durable fact for this user. Tap-to-act
            quick prompt appears alongside on Tony Starrk. Empty state stays
            unchanged for first-time users. */}
        {memoryHint.hint && (
          <div
            className="mt-4 mx-auto max-w-xl rounded-2xl px-4 py-3 text-start border"
            style={{
              borderColor: persona === "omar" ? "#5B4BF533" : "#0E8A6B33",
              background: persona === "omar" ? "#5B4BF50A" : "#0E8A6B0A",
            }}
          >
            <p className="text-[13px] text-ink/75 leading-relaxed">{memoryHint.hint}</p>
            {memoryHint.quickPrompt && (
              <button
                type="button"
                onClick={() => onQuick(memoryHint.quickPrompt!)}
                className="mt-2 inline-flex items-center h-8 px-3 rounded-full text-[12.5px] font-medium transition active:scale-95"
                style={{
                  background: persona === "omar" ? "#5B4BF5" : "#0E8A6B",
                  color: "#ffffff",
                }}
              >
                {memoryHint.quickPrompt}
              </button>
            )}
          </div>
        )}
        {/* Sherlock entry cards — discoverable hooks into Sherlock's deeper
            capabilities. Two cards in v1:
              1. Mental health check-in (Day 13) → opens PHQ-9/GAD-7 modal
              2. Talk about a relationship (Day 15) → seeds the chat
                 with a relationship prompt; Sherlock's relationship-advisor
                 system prompt block takes it from there. Both hidden
                 for Tony Starrk (he has his own surfaces). */}
        {/* Tony Starrk entry card — Start focus session (Day 18). Lives on
            the empty state so it's discoverable without Tony Starrk having
            to suggest it every conversation. Shown only when there
            isn't an active session already. */}
        {persona === "omar" && onOpenSession && (
          <div className="mt-6 max-w-md mx-auto">
            <button
              onClick={onOpenSession}
              className="w-full text-start rounded-2xl border border-[#5B4BF5]/30 hover:border-[#5B4BF5]/55 bg-[#5B4BF5]/[6%] hover:bg-[#5B4BF5]/[10%] transition px-4 py-3.5 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-[#5B4BF5]/15 inline-flex items-center justify-center shrink-0 text-base">🎯</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-[14px]">Start focus session</div>
                  <div className="text-[12.5px] text-ink/55 mt-0.5">Pomodoro timer + I'll keep you on track. Pick a subject and a goal.</div>
                </div>
                <span className="text-ink/40 text-base shrink-0">→</span>
              </div>
            </button>
          </div>
        )}
        {persona === "noor" && (
          <div className="mt-6 max-w-md mx-auto space-y-2">
            {onOpenScreen && (
              <button
                onClick={onOpenScreen}
                className="w-full text-start rounded-2xl border border-[#0E8A6B]/30 hover:border-[#0E8A6B]/55 bg-[#0E8A6B]/[6%] hover:bg-[#0E8A6B]/[10%] transition px-4 py-3.5 active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-[#0E8A6B]/15 inline-flex items-center justify-center shrink-0 text-base">💚</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink text-[14px]">Take a 2-min check-in</div>
                    <div className="text-[12.5px] text-ink/55 mt-0.5">Validated PHQ-9 or GAD-7 — private, not a diagnosis.</div>
                  </div>
                  <span className="text-ink/40 text-base shrink-0">→</span>
                </div>
              </button>
            )}
            <button
              onClick={() => onQuick("I want to talk about something happening in a relationship — could be romantic, a friendship, or family.")}
              className="w-full text-start rounded-2xl border border-[#C23F6C]/25 hover:border-[#C23F6C]/45 bg-[#C23F6C]/[5%] hover:bg-[#C23F6C]/[9%] transition px-4 py-3.5 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-[#C23F6C]/15 inline-flex items-center justify-center shrink-0 text-base">🫂</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-[14px]">Talk about a relationship</div>
                  <div className="text-[12.5px] text-ink/55 mt-0.5">Romantic, friendship, family — anything that's complicated right now.</div>
                </div>
                <span className="text-ink/40 text-base shrink-0">→</span>
              </div>
            </button>
          </div>
        )}
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {memory.prompts.map((p) => {
            const personalised = isMemoryDriven(p);
            // Personalised prompts get the subject palette tint so
            // they read as the eye's first stop. Generic prompts
            // keep the neutral border to avoid visual noise.
            const style = personalised && accent
              ? {
                  borderColor: `${accent.accent}55`,
                  color: accent.accent,
                  background: `${accent.accent}0D`,
                }
              : undefined;
            return (
              <button
                key={p}
                onClick={() => onQuick(p)}
                className={
                  personalised && accent
                    ? "h-9 px-3.5 rounded-full border text-[13px] hover:opacity-80 transition active:scale-95"
                    : "h-9 px-3.5 rounded-full border border-ink/12 text-[13px] text-ink/75 hover:border-ink/35 hover:text-ink hover:bg-ink/5 transition"
                }
                style={style}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Persona inference + crisis classification moved to ./personaRouting
// (bilingual EN+AR keyword tables + force-switch on crisis language).
// AIScreen now calls decideRouting() for a single three-way decision.


// ───────────────────────── stream pieces ─────────────────────────

function PersonaToggle({ value, onChange }: { value: AIPersona; onChange: (p: AIPersona) => void }) {
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div role="tablist" className="relative inline-flex items-center h-9 p-0.5 rounded-full bg-ink/6">
        <span
          className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-bg shadow-sm transition-transform"
          style={{ transform: value === "omar" ? "translateX(0)" : "translateX(100%)" }}
        />
        <button
          role="tab"
          aria-selected={value === "omar"}
          aria-label="Tony Starrk — tutor and study plans"
          title="Tony Starrk — tutor & study plans"
          onClick={() => onChange("omar")}
          className={"relative z-10 h-8 px-4 rounded-full text-sm font-medium inline-flex items-center gap-1.5 transition " + (value === "omar" ? "text-ink" : "text-ink/55")}
        >
          <Brain size={14} /> Tony Starrk
        </button>
        <button
          role="tab"
          aria-selected={value === "noor"}
          aria-label="Sherlock — wellbeing, mental health, relationships"
          title="Sherlock — wellbeing & relationships"
          onClick={() => onChange("noor")}
          className={"relative z-10 h-8 px-4 rounded-full text-sm font-medium inline-flex items-center gap-1.5 transition " + (value === "noor" ? "text-ink" : "text-ink/55")}
        >
          <Heart size={14} /> Sherlock
        </button>
      </div>
      {/* Tiny descriptor under the active tab so first-time students
          understand what each persona is for. ChatGPT-style tabs alone
          (just "Tony Starrk" / "Sherlock") were too opaque — friends defaulted to
          Tony Starrk for everything because Sherlock's purpose was invisible. */}
      <div className="text-[10.5px] text-ink/45 leading-tight tracking-tight tabular-nums">
        {value === "omar" ? "tutor & study plans" : "wellbeing & relationships"}
      </div>
    </div>
  );
}

/** Tutor-mode toggle — three pills sitting above the composer. Picks
 *  between Hints (strict Socratic — default), Teach (proactive
 *  explanation), and Walkthrough (guided step-by-step where the
 *  student writes every line). Sent to /api/ai/tutor as `mode`.
 *  Only rendered for Tony Starrk — Sherlock doesn't use tutor modes.
 *
 *  Layout: scrollable on narrow phones so all three labels stay
 *  readable; on desktop the row is short enough to fit naturally.
 *  Active mode gets a white pill background to mirror PersonaToggle's
 *  visual language (familiar tab affordance). */
function TutorModeToggle({
  value, onChange,
}: {
  value: TutorMode;
  onChange: (m: TutorMode) => void;
}) {
  const modes: {
    id: TutorMode;
    label: string;
    hint: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "auto",
      label: "Auto",
      hint: "Tony Starrk picks the right approach for each question",
      icon: <Sparkles size={12} />,
    },
    {
      id: "homework_help",
      label: "Hints",
      hint: "Socratic — Tony Starrk asks questions, you solve",
      icon: <Lightbulb size={12} />,
    },
    {
      id: "study_mode",
      label: "Teach",
      hint: "Tony Starrk explains the concept, then you practice",
      icon: <BookOpen size={12} />,
    },
    {
      id: "homework_helper",
      label: "Walkthrough",
      hint: "Step-by-step — you write each line, Tony Starrk confirms",
      icon: <ListChecks size={12} />,
    },
  ];
  return (
    <div className="-mx-1 mb-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
      <span className="shrink-0 text-[10.5px] uppercase tracking-wider text-ink/45 px-1">
        Mode
      </span>
      {modes.map((m) => {
        const active = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={m.hint}
            onClick={() => onChange(m.id)}
            className={
              "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-medium transition active:scale-95 whitespace-nowrap " +
              (active
                ? "bg-[#5B4BF5] border-[#5B4BF5] text-white"
                : "bg-bg border-ink/12 text-ink/70 hover:bg-ink/5 hover:text-ink")
            }
          >
            {m.icon}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Quick-action pills shown above the composer once a chat is in
 *  progress. These are global one-tap shortcuts ("Quiz me", "Make it
 *  simpler", "Give me a similar problem") — different set per
 *  persona. Tap = sends that text as the next message. They don't
 *  replace the AI's per-message <<<OPTIONS>>> chips (those are
 *  contextual to the AI's last question) — they complement them as
 *  always-available follow-ups. */
const OMAR_QUICK_ACTIONS = [
  "Quiz me on this",
  "Make it simpler",
  "Give me a similar problem",
  "Summarize what we covered",
];
const NOOR_QUICK_ACTIONS = [
  "Just listen, no advice",
  "Give me a grounding exercise",
  "Help me see this differently",
  "What can I do right now?",
];

// Preserved legacy "above composer" chip row. Replaced by per-message
// chips inside AIMessageView; kept here as a rollback escape hatch.
// Underscore prefix tells TS we intentionally aren't calling it.
function _LegacyQuickActions({ persona, onTap }: { persona: AIPersona; onTap: (text: string) => void }) {
  const actions = persona === "omar" ? OMAR_QUICK_ACTIONS : NOOR_QUICK_ACTIONS;
  return (
    // Horizontally scrollable on mobile so 4 buttons fit on a phone
    // without wrapping the row taller than necessary. On desktop they
    // wrap naturally. `-mx` cancels the parent padding so the scroll
    // edges hit the screen edge for a more natural touch feel.
    <div className="-mx-1 mb-1.5 flex gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
      {actions.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onTap(label)}
          className="shrink-0 text-[12.5px] h-7 px-3 rounded-full border border-ink/12 bg-bg text-ink/70 hover:bg-ink/5 hover:text-ink transition active:scale-95 whitespace-nowrap"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
// Intentionally referenced so TS doesn't flag the rollback function.
void _LegacyQuickActions;

/** Streak chip — small flame + day count, sits in the header next to
 *  the quota chip. Color shifts at higher tiers so a long streak
 *  feels visually distinct from a 1-day streak (small reward signal,
 *  doesn't need an animation).
 *
 *  Tooltip surfaces the next-milestone target — light gamification
 *  signal so the student sees "X more days to your next badge"
 *  without needing a full modal. Longest is included too so a user
 *  who's mid-reset (current=2, longest=47) sees that 47 isn't lost. */
function StreakChip({
  current, longest, milestonesReached,
}: {
  current: number;
  longest: number;
  milestonesReached: number[];
}) {
  // Color tier: cool blue 1-2 → orange 3-6 → red-orange 7-29 → gold 30+
  const tier =
    current >= 30 ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : current >= 7 ? "bg-orange-500/15 text-orange-600 border-orange-500/30"
    : current >= 3 ? "bg-orange-400/15 text-orange-500 border-orange-400/30"
    :                "bg-ink/5 text-ink/70 border-ink/12";
  // Find the next un-reached milestone above current.
  const nextMilestone = MILESTONES.find(
    (m) => m > current && !milestonesReached.includes(m),
  );
  const tooltip = (() => {
    const lines: string[] = [`${current}-day streak`];
    if (nextMilestone) {
      const days = nextMilestone - current;
      lines.push(`${days} ${days === 1 ? "day" : "days"} to your next milestone (${nextMilestone}).`);
    }
    if (longest > current) {
      lines.push(`Longest: ${longest} days.`);
    }
    return lines.join("\n");
  })();
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium tabular-nums border ${tier}`}
      title={tooltip}
    >
      <Flame size={13} className={current >= 3 ? "fill-current" : ""} />
      {current}
    </span>
  );
}

/** Milestone celebration toast — fixed-position card that drops in from
 *  the top when the user crosses a never-seen-before streak tier. The
 *  copy is variable per tier (see MILESTONE_COPY in useStreak.ts) so
 *  the same milestone hit twice (after a reset) feels fresh. Auto-
 *  dismisses after 6s; tap to dismiss early. */
function MilestoneToast({
  event, onDismiss,
}: {
  event: MilestoneEvent;
  onDismiss: () => void;
}) {
  // Auto-dismiss timer. Cleared on unmount or user-tap.
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);
  return (
    // role="status" so screen readers announce the milestone but
    // don't interrupt focus — students might be mid-typing a question.
    <div
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-32px)] cursor-pointer animate-[fadeInDown_240ms_ease-out]"
      style={{
        // Inline keyframes via the single-style trick — keeps this
        // self-contained instead of polluting the global stylesheet
        // for one toast.
        animation: "fadeInDown 240ms ease-out",
      }}
    >
      <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-xl px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none shrink-0" aria-hidden>{event.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[16px] leading-tight">{event.title}</div>
            <div className="mt-1 text-[13.5px] leading-snug opacity-95">{event.body}</div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="shrink-0 -mt-0.5 -mr-1 w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-white/15 transition"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuotaChip() {
  const { subscription } = useApp();
  if (subscription.tier === "pro") {
    return <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink text-bg text-xs font-medium"><InfinityIcon size={13} /> Pro</span>;
  }
  const low = subscription.aiQuota <= 5;
  return (
    <span className={"inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium tabular-nums " + (low ? "bg-[#C23F6C]/10 text-[#C23F6C]" : "bg-ink/5 text-ink/70")}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {subscription.aiQuota} / {subscription.aiCap} left today
    </span>
  );
}

function ComposerRow({
  draft, setDraft, onKey, onSend, over, busy, persona, onPickFile, fileRef, attachmentPresent,
}: {
  draft: string; setDraft: (s: string) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  over: boolean;
  /** AI is currently streaming a response — disable send so a rapid
   *  double-tap doesn't get silently swallowed by useStreamingAI's
   *  loading-guard returning `reason: "rate"`. Audit P1 #2. */
  busy: boolean;
  persona: AIPersona;
  onPickFile: (e: ChangeEvent<HTMLInputElement>) => void;
  fileRef: React.RefObject<HTMLInputElement>;
  attachmentPresent: boolean;
}) {
  return (
    // Tightened composer:
    //   • Outer padding reduced from p-1.5 → p-1
    //   • Internal gap reduced from gap-1.5 → gap-1
    //   • Action buttons shrunk from w-9/h-9 (36px) → w-8/h-8 (32px)
    //   • Textarea vertical padding tightened from py-[7px] → py-[5px]
    //   • Textarea horizontal padding kept (px-1) so the cursor
    //     doesn't hug the button. Result: ~30% less visual weight
    //     while preserving 32 px tap targets (still passes a11y).
    <div className={`flex items-end gap-1 rounded-2xl border p-1 bg-bg transition ${over ? "border-ink/10 opacity-60" : "border-ink/15 focus-within:border-ink/35"}`}>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={over || busy}
        aria-label="Attach a file"
        className="w-8 h-8 shrink-0 rounded-full inline-flex items-center justify-center text-ink/60 hover:text-ink hover:bg-ink/5 transition disabled:opacity-40 disabled:cursor-default"
      ><Plus size={15} /></button>
      <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" className="hidden" onChange={onPickFile} />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder={over ? "Daily limit reached — upgrade to continue" :
          busy ? "Still answering — hold on a sec…" :
          persona === "omar" ? "Ask Tony Starrk anything…" : "Share what's on your mind…"}
        disabled={over}
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-ink placeholder:text-ink/40 px-1 py-[5px] max-h-28 leading-5 text-[14.5px]"
      />
      <button
        onClick={onSend}
        disabled={over || busy || (!draft.trim() && !attachmentPresent)}
        aria-label="Send message"
        className="w-8 h-8 shrink-0 rounded-full bg-ink text-bg inline-flex items-center justify-center disabled:opacity-25 hover:bg-ink/85 transition"
      ><ArrowUp size={15} /></button>
    </div>
  );
}

function MessageRow({
  msg, onSwitchPersona, onDismissSuggestion, onQuickReply, isSaved, onToggleSave,
  priorUserMessageText, isLatestAi,
}: {
  msg: AIMessage;
  onSwitchPersona?: (p: AIPersona) => void;
  onDismissSuggestion?: (msgId: string) => void;
  /** Tap handler for quick-reply chips below an AI message. Sends
   *  the chip's text as the student's next message. */
  onQuickReply?: (text: string) => void;
  /** Bookmark state + toggle. Only meaningful on AI messages. */
  isSaved?: boolean;
  onToggleSave?: () => void;
  /** Most recent user message text BEFORE this AI message — passed
   *  to the feedback row so a thumbs-down captures both prompt and
   *  reply in the same row. Null for non-AI messages. */
  priorUserMessageText?: string | null;
  /** True when this AI message is the most-recent one in the thread.
   *  Drives whether to render the global quick-action chips below
   *  the bubble. Old AI messages don't show them — sending a new
   *  message moves the chips automatically to the new reply. */
  isLatestAi?: boolean;
}) {
  if (msg.role === "user") return <UserMessage msg={msg} />;
  if (msg.role === "system") {
    // Switch-suggestion cards get the explicit two-button render so
    // the user can choose without ever being force-switched.
    if (msg.switchSuggestion) {
      return (
        <SwitchSuggestionCard
          msg={msg}
          onSwitch={(p) => {
            onSwitchPersona?.(p);
            onDismissSuggestion?.(msg.id);
          }}
          onStay={() => onDismissSuggestion?.(msg.id)}
        />
      );
    }
    return <SystemNotice msg={msg} />;
  }
  return (
    <AIMessageView
      msg={msg}
      onQuickReply={onQuickReply}
      isSaved={isSaved}
      onToggleSave={onToggleSave}
      priorUserMessageText={priorUserMessageText}
      isLatestAi={isLatestAi}
    />
  );
}

/** Small centered pill used for auto-switch notices and similar
 *  breadcrumb events. Not a chat bubble — deliberately low-volume. */
function SystemNotice({ msg }: { msg: AIMessage }) {
  const color = msg.persona === "omar" ? "#5B4BF5" : "#0E8A6B";
  const icon = msg.persona === "omar" ? <Brain size={11} /> : <Heart size={11} />;
  return (
    <div className="flex justify-center">
      <div
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-medium tracking-wide"
        style={{ background: `${color}14`, color }}
      >
        {icon}
        <span>{msg.body}</span>
      </div>
    </div>
  );
}

/** Two-button card that lets the user explicitly choose whether to
 *  switch personas. Replaces the old auto-force-switch. The user can
 *  also keep using the PersonaToggle at the top — this card is just
 *  a polite contextual prompt, not the only way to switch. */
function SwitchSuggestionCard({
  msg, onSwitch, onStay,
}: {
  msg: AIMessage;
  onSwitch: (p: AIPersona) => void;
  onStay: () => void;
}) {
  const sug = msg.switchSuggestion!;
  const suggestedColor = sug.suggested === "omar" ? "#5B4BF5" : "#0E8A6B";
  const suggestedLabel = sug.suggested === "omar" ? "Tony Starrk" : "Sherlock";
  const currentLabel = sug.current === "omar" ? "Tony Starrk" : "Sherlock";
  const SuggestedIcon = sug.suggested === "omar" ? Brain : Heart;
  return (
    <div className="flex justify-center">
      <div className="max-w-md w-full rounded-2xl bg-ink/5 border border-ink/10 px-4 py-3">
        <div className="text-[13px] text-ink/75 mb-3 leading-relaxed">{msg.body}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSwitch(sug.suggested)}
            className="flex-1 h-9 rounded-full text-[13px] font-medium inline-flex items-center justify-center gap-1.5 text-white transition hover:opacity-90"
            style={{ background: suggestedColor }}
          >
            <SuggestedIcon size={13} /> Switch to {suggestedLabel}
          </button>
          <button
            type="button"
            onClick={onStay}
            className="flex-1 h-9 rounded-full text-[13px] font-medium bg-bg border border-ink/15 text-ink/75 hover:bg-ink/5 transition"
          >
            Stay with {currentLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: AIMessage }) {
  // Three attachment kinds, three render paths:
  //   - image: compressed dataUrl thumbnail (already sent to vision API)
  //   - pdf with pdfMeta: smart book preview card (page count, etc.)
  //   - everything else: existing filename pill
  const isImage = msg.attachment?.kind === "image" && !!msg.attachment.url;
  const isPdfWithMeta = msg.attachment?.kind === "pdf" && !!msg.attachment.pdfMeta;
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-3xl rounded-br-lg bg-ink text-bg px-4 py-3">
        {isImage && msg.attachment?.url && (
          <img
            src={msg.attachment.url}
            alt={msg.attachment.name || "Attached image"}
            loading="lazy"
            className="mb-2 max-w-[280px] max-h-[280px] w-auto h-auto rounded-2xl object-contain bg-bg/5"
          />
        )}
        {isPdfWithMeta && msg.attachment && (() => {
          // PDF preview card. Three render layers:
          //   1. Headline: PDF-embedded title when present, otherwise
          //      filename (without the .pdf extension for cleanliness).
          //   2. Subline: page count · file size · creator software
          //      ("Microsoft Word", "LaTeX", etc.) — each piece shown
          //      only when known. Dots are inserted between present
          //      pieces only, no orphan separators.
          //   3. Footer: confirms which AI has read it (Tony Starrk or Sherlock).
          //
          // Page count comes from pdfMetaPeek (byte-level regex, no
          // parser). When unknown (pageCount === 0), we just omit it
          // and fall back to size — same graceful behavior as before.
          const meta = msg.attachment.pdfMeta!;
          const sizeBytes = meta.characterCount; // We store raw bytes here.
          const sizeKb = sizeBytes > 0 ? Math.round(sizeBytes / 1024) : 0;
          const sizeLabel = sizeKb >= 1024
            ? `${(sizeKb / 1024).toFixed(1)} MB`
            : sizeKb > 0 ? `${sizeKb} KB` : null;
          const rawTitle = (meta.title ?? "").trim();
          const filenameClean = (msg.attachment.name || "Document").replace(/\.pdf$/i, "");
          const headline = rawTitle.length > 0 ? rawTitle : filenameClean;
          // Show filename underneath as secondary info when title
          // differs from filename — useful when the PDF was saved
          // with a friendly title but the file got renamed on disk.
          const showFilenameSecondary = rawTitle.length > 0 && rawTitle.toLowerCase() !== filenameClean.toLowerCase();
          const pageLabel = meta.pageCount > 0
            ? `${meta.pageCount} ${meta.pageCount === 1 ? "page" : "pages"}`
            : null;
          const producerLabel = (meta.producer || "").trim() || null;
          // Footer text — show the active persona, never the
          // deprecated "Bas Udros" / "Ustaz" names.
          const personaLabel = msg.persona === "noor" ? "Sherlock" : "Tony Starrk";
          const subInfo = [pageLabel, sizeLabel, producerLabel].filter(Boolean).join(" · ");
          return (
            <div className="mb-2 rounded-2xl bg-bg/10 border border-bg/15 px-3.5 py-3 max-w-[320px]">
              <div className="flex items-start gap-2.5 mb-2">
                <span className="w-9 h-11 rounded-md bg-bg/15 inline-flex items-center justify-center shrink-0 mt-0.5"
                  // Slight book-cover proportions to read more as "document"
                  // and less as "icon". Same color treatment as before so
                  // it doesn't fight the bubble.
                >
                  <FileText size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold leading-tight truncate" title={headline}>
                    {headline}
                  </div>
                  {showFilenameSecondary && (
                    <div className="text-[11px] text-bg/55 truncate mt-0.5" title={msg.attachment.name}>
                      {msg.attachment.name}
                    </div>
                  )}
                  {meta.author && meta.author.trim().length > 0 && (
                    <div className="text-[11px] text-bg/65 truncate mt-0.5">
                      by {meta.author}
                    </div>
                  )}
                </div>
              </div>
              {subInfo && (
                <div className="text-[11.5px] text-bg/70 leading-relaxed">
                  {subInfo}
                </div>
              )}
              <div className="text-[11px] text-bg/55 pt-1.5">
                {personaLabel} has read this and can answer questions about it.
              </div>
            </div>
          );
        })()}
        {!isImage && !isPdfWithMeta && msg.attachment && (
          <div className="mb-2 inline-flex items-center gap-2 h-8 px-2.5 rounded-full bg-bg/10 text-xs">
            <FileText size={12} />
            <span className="truncate max-w-[180px]">{msg.attachment.name}</span>
          </div>
        )}
        {msg.body && (
          <p className="text-[15px] leading-[1.45] whitespace-pre-wrap">{msg.body}</p>
        )}
      </div>
    </div>
  );
}

function AIMessageView({
  msg, onQuickReply, isSaved, onToggleSave, priorUserMessageText, isLatestAi,
}: {
  msg: AIMessage;
  onQuickReply?: (text: string) => void;
  isSaved?: boolean;
  onToggleSave?: () => void;
  /** Prior user message text — used by the feedback row to snapshot
   *  the full context of a 👎. Optional and gracefully missing. */
  priorUserMessageText?: string | null;
  /** True when this is the most-recent AI message in the thread.
   *  Renders the always-available global quick-action chips
   *  underneath. Sending a new message naturally moves them to the
   *  new reply (old chips disappear). */
  isLatestAi?: boolean;
}) {
  const subject: AISubject = msg.subject ?? "general";
  const fallback = fallbackGradient(msg.id, msg.persona);
  // 3D artifact comes from a dynamic-imported module (messageBg3d) so
  // the ~470KB Three.js dependency only ships when the user actually
  // sees an AI message. Until it resolves we render the lightweight
  // CSS gradient — same seed, similar vibe, instantly visible.
  // After the module + render finish, we swap in the PNG data URL.
  const [bgUrl, setBgUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    void import("./messageBg3d").then((mod) => {
      if (cancelled) return;
      try {
        const url = mod.renderMessageBg(msg.id, msg.persona, subject, { w: 640, h: 400 });
        if (!cancelled) setBgUrl(url);
      } catch {
        // WebGL failed (old phone, no-WebGL browser) — gradient fallback
        // is already showing, so just leave it.
      }
    }).catch(() => {
      // Dynamic import failed — same fallback, no action needed.
    });
    return () => { cancelled = true; };
  }, [msg.id, msg.persona, subject]);
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] md:max-w-[88%] w-full">
        <div className="relative rounded-3xl overflow-hidden">
          {/* iPhone Portrait Mode vibe: blur the rendered 3D
              background so the message text becomes the clear focal
              point while the design / palette of the artwork still
              comes through softly behind it. The slight scale-up
              prevents the blur from revealing transparent edges at
              the bubble corners (standard CSS-blur trick).
              `transform` + `filter` are GPU-accelerated, so this
              stays cheap to scroll even on a long chat. */}
          <div className="absolute inset-0"
            style={{
              backgroundImage: bgUrl ? `url(${bgUrl})` : fallback,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(14px) saturate(0.8) brightness(0.92)",
              transform: "scale(1.08)",
              transformOrigin: "center",
            }}
            aria-hidden />
          {/* Stronger, more uniform overlay so white text stays
              readable no matter what palette the per-message 3D
              rendered. Bumped from `from-black/45 via-black/50
              to-black/75` to a slightly heavier mix so the new
              larger body text reads cleanly even on bright shader
              frames. The body itself also adds a stronger
              text-shadow (in TutorMessageBody) for extra crispness. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/60 to-black/80" aria-hidden />
          <div className="relative px-6 py-7 md:px-8 md:py-9">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full bg-white/25 backdrop-blur inline-flex items-center justify-center text-white">
                {msg.persona === "omar" ? <Brain size={12} /> : <Heart size={12} />}
              </span>
              <span className="text-white text-xs uppercase tracking-wider" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
                {msg.persona === "omar" ? "Tony Starrk" : "Sherlock"}
              </span>
              {msg.subject && msg.subject !== "general" && (() => {
                // Subject pill — uses the per-subject palette so a math
                // bubble shows an indigo pill with a 📐 glyph, biology
                // shows a green 🧬, etc. Lets the eye identify the
                // subject without reading the label. Border glow uses
                // the same accent at low opacity to keep contrast on
                // the bubble's dark background.
                const p = paletteFor(msg.subject);
                return (
                  <span
                    className="ml-1 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-medium uppercase tracking-wider border"
                    style={{
                      background: `${p.accent}28`,
                      color: "#ffffff",
                      borderColor: `${p.accent}60`,
                      textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 12 }}>{p.emoji}</span>
                    {p.label}
                  </span>
                );
              })()}
            </div>
            {/* TutorMessageBody renders **bold**, *italic*, lists,
                headers, and code blocks (the system prompt instructs
                Bas Udros to use these). Previously we showed the raw
                literal asterisks/hashes which hurt readability.
                Component also bumps font sizes + line-height for the
                "more noticeable / easier to read" experience. */}
            <TutorMessageBody body={msg.body} />
          </div>
        </div>
        {/* Artifact dispatcher — routes to the right renderer by
            artifact.kind. Add new artifact types here as they ship. */}
        {msg.artifact && msg.artifact.kind === "studyPlan" && (
          <StudyPlanArtifact artifact={msg.artifact} />
        )}
        {msg.artifact && msg.artifact.kind === "professorEmail" && (
          <ProfessorEmailArtifact artifact={msg.artifact} />
        )}
        {msg.artifact && msg.artifact.kind === "relationshipMessage" && (
          <RelationshipMessageArtifact artifact={msg.artifact} />
        )}
        {msg.artifact && msg.artifact.kind === "cv" && (
          <CvArtifact artifact={msg.artifact} />
        )}
        {/* Global quick-action chips — "Quiz me on this",
            "Make it simpler", etc. Only rendered on the LATEST AI
            message. Sending a new message naturally hides them
            because a newer AI reply becomes latest. Skip on the
            streaming preview (msg.id === "streaming"). Persona-tinted
            outline so they read as suggestions, not primary actions. */}
        {isLatestAi && msg.id !== "streaming" && onQuickReply && (() => {
          const actions = msg.persona === "omar" ? OMAR_QUICK_ACTIONS : NOOR_QUICK_ACTIONS;
          const accent = msg.persona === "omar" ? "#5B4BF5" : "#0E8A6B";
          return (
            <div className="mt-3 flex flex-wrap gap-1.5 px-1">
              {actions.map((label) => (
                <button
                  key={`${msg.id}-qa-${label}`}
                  type="button"
                  onClick={() => onQuickReply(label)}
                  className="inline-flex items-center text-[12.5px] h-8 px-3 rounded-full border transition active:scale-95 whitespace-nowrap"
                  style={{
                    borderColor: `${accent}33`,
                    color: "rgba(0,0,0,0.65)",
                    background: "transparent",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          );
        })()}
        {/* Quick-reply chips — extracted from the AI's <<<OPTIONS>>>
            block. Tappable shortcuts so students don't have to type.
            Rendered below the bubble so they don't compete visually
            with the AI's prose. Color-keyed to the persona. */}
        {msg.quickReplies && msg.quickReplies.length > 0 && onQuickReply && (() => {
          // Quick-reply chips — color-keyed to the subject palette so
          // a math conversation's chips are indigo, biology's are
          // green, etc. Falls back to persona color (Tony Starrk violet,
          // Sherlock teal) when subject is unset or "general", matching
          // the previous behaviour. Inline style instead of arbitrary
          // Tailwind values so the palette table is the single source
          // of truth.
          const useSubject = msg.subject && msg.subject !== "general";
          const accent = useSubject
            ? paletteFor(msg.subject).accent
            : msg.persona === "omar" ? "#5B4BF5" : "#0E8A6B";
          return (
            <div className="mt-3 flex flex-wrap gap-2 px-1">
              {msg.quickReplies!.map((reply, i) => (
                <button
                  key={`${msg.id}-qr-${i}`}
                  type="button"
                  onClick={() => onQuickReply(reply)}
                  className="text-[13px] px-3.5 h-9 rounded-full border transition active:scale-95"
                  style={{
                    borderColor: `${accent}4D`,        // 30% alpha
                    color: accent,
                    background: `${accent}0D`,         // ~5% alpha
                  }}
                >
                  {reply}
                </button>
              ))}
            </div>
          );
        })()}
        {/* Action row — feedback (👍/👎) on the left, bookmark on the
            right. Both are no-ops for the streaming preview row (which
            uses id="streaming") because the message hasn't committed
            yet. Feedback is fire-and-forget into tutor_feedback;
            bookmark toggles tutor_saved_messages. */}
        {onToggleSave && msg.id !== "streaming" && (
          <div className="mt-2 px-1 flex items-center justify-between">
            <FeedbackRow
              persona={msg.persona}
              messageText={msg.body}
              userMessageText={priorUserMessageText}
            />
            <button
              type="button"
              onClick={onToggleSave}
              aria-label={isSaved ? "Remove from saved" : "Save this reply"}
              aria-pressed={!!isSaved}
              className={`inline-flex items-center gap-1.5 text-[12px] h-7 px-2.5 rounded-full transition active:scale-95 ${
                isSaved
                  ? "text-ink/85 bg-ink/8"
                  : "text-ink/45 hover:text-ink/75 hover:bg-ink/5"
              }`}
            >
              {isSaved
                ? <BookmarkCheck size={13} />
                : <Bookmark size={13} />}
              <span>{isSaved ? "Saved" : "Save"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Preserved legacy three-dots-only thinking indicator. Replaced in
 *  the stream by ThinkingStatus (adaptive phrasing) but kept here for
 *  easy rollback — flip the call site back to <_LegacyThinkingRow />
 *  if the new indicator ever causes problems. Underscore prefix tells
 *  TypeScript we intentionally aren't calling it right now. */
function _LegacyThinkingRow({ persona }: { persona: AIPersona }) {
  const tone = persona === "omar" ? "bg-[#5B4BF5]" : "bg-[#0E8A6B]";
  return (
    <div className="flex justify-start">
      <div className="rounded-full bg-ink/5 px-4 py-2.5 inline-flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${tone} animate-pulse`} style={{ animationDelay: "0ms" }} />
        <span className={`w-1.5 h-1.5 rounded-full ${tone} animate-pulse`} style={{ animationDelay: "150ms" }} />
        <span className={`w-1.5 h-1.5 rounded-full ${tone} animate-pulse`} style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}
// Intentionally unused export-shaped reference so the linter doesn't
// flag the rollback escape hatch above. Never imported elsewhere.
void _LegacyThinkingRow;

// ───────────────────────── helpers ─────────────────────────

function fileKind(name: string): "image" | "pdf" | "doc" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "doc";
}

