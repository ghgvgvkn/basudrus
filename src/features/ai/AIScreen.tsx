/**
 * AIScreen — two modes.
 *
 * 1) **Hero** (empty state, iteration 3):
 *    Two oversized persona cards side-by-side — Omar (violet, neural
 *    bloom) and Noor (teal, liquid wave). Each card has its own live
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
import { TutorMessageBody } from "./TutorMessageBody";
import { useStreamingAI, type ChatMsg } from "./useStreamingAI";
import {
  Infinity as InfinityIcon, ArrowUp, Sparkles, Brain, Heart,
  FileText, X, Plus,
} from "lucide-react";

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

export function AIScreen() {
  const { aiPrefill, setAIPrefill, subscription, consumeAIMessage, setScreen, profile } = useApp();
  const { dir, lang } = useLocale();

  const [persona, setPersona] = useState<AIPersona>("omar");
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Real Anthropic-backed streaming. partial holds the in-flight
  // assistant text — we render it as the last message live, then
  // commit to `messages` when the stream finishes.
  const ai = useStreamingAI();
  const isThinking = ai.loading;

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

    // Auto-persona routing — switch endpoints if the keywords look
    // like the other mode's territory.
    const inferred = inferPersona(body, persona);
    const isSwitching = inferred !== persona;
    const activePersona = inferred;

    const extras: AIMessage[] = [];
    if (isSwitching) {
      extras.push({
        id: `sys-${Date.now()}`,
        role: "system",
        persona: activePersona,
        body: activePersona === "noor"
          ? "Switching you to Noor — this sounds like an exam-stress / motivation question."
          : "Switching you to Omar — this sounds like a study question.",
        createdAt: new Date().toISOString(),
      });
      setPersona(activePersona);
    }

    const subject = inferSubject(body, activePersona);
    const userMsg: AIMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      persona: activePersona,
      body: body || (file ? `Sent ${file.name}` : ""),
      subject,
      createdAt: new Date().toISOString(),
      attachment: file ? { name: file.name, kind: fileKind(file.name) } : undefined,
    };
    setMessages((m) => [...m, ...extras, userMsg]);
    setDraft("");
    setAttachment(null);

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
    });

    if (result.ok) {
      const aiMsg: AIMessage = {
        id: `a-${Date.now()}`,
        role: "ai",
        persona: activePersona,
        body: result.assistant,
        subject,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, aiMsg]);
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

  const send = () => sendWith(draft.trim(), attachment);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setAttachment(f);
    e.target.value = "";
  };

  return (
    <div className="relative flex flex-col h-[calc(100dvh-64px)] md:h-[calc(100dvh-56px)]" dir={dir}>
      {/* Header — persona toggle is always visible now so users can
          manually override the auto-switch, and the chat never feels
          like it's locked to one mode. */}
      <div className="flex items-center gap-2 px-4 md:px-6 h-14 border-b border-ink/8">
        <PersonaToggle value={persona} onChange={(p) => {
          // Don't wipe the thread on manual switch — that was
          // friction. If the user wants a fresh thread they can
          // use "New chat" (history drawer, future slice).
          setPersona(p);
        }} />
        <div className="ml-auto flex items-center gap-2">
          <QuotaChip />
          {subscription.tier === "free" && (
            <button
              onClick={() => setScreen("subscription")}
              className="h-8 px-3 rounded-full bg-ink text-bg text-xs font-medium hover:bg-ink/85 transition inline-flex items-center gap-1.5"
            >
              <Sparkles size={12} /> Go Pro
            </button>
          )}
        </div>
      </div>

      {/* Body — chat stream. The empty state is just a minimal greeting
          + quick prompts; the composer sits at the bottom like any
          real chat. No more giant persona-picker box. */}
      <div ref={streamRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyChatState
            persona={persona}
            onQuick={(text) => sendWith(text, null)}
          />
        ) : (
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
            {messages.map((m) => <MessageRow key={m.id} msg={m} />)}
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
                  body: ai.partial,
                  createdAt: new Date().toISOString(),
                }}
              />
            )}
            {isThinking && !ai.partial && <ThinkingRow persona={persona} />}
          </div>
        )}
      </div>

      {/* Composer — always visible, not just in stream mode. This is
          the "open chat by default" behaviour from the earlier design. */}
      <div className="border-t border-ink/8 bg-bg">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-3">
          {attachment && (
            <div className="mb-2 inline-flex items-center gap-2 h-9 px-3 rounded-full bg-ink/5 border border-ink/10 text-sm">
              <FileText size={14} className="text-ink/60" />
              <span className="truncate max-w-[200px]">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-ink/40 hover:text-ink"><X size={14} /></button>
            </div>
          )}
          <ComposerRow
            draft={draft} setDraft={setDraft}
            onKey={onKey} onSend={send}
            over={over} persona={persona}
            onPickFile={onPickFile} fileRef={fileRef}
            attachmentPresent={!!attachment}
          />
          <p className="mt-2 text-[11px] text-ink/40 text-center">
            {persona === "omar"
              ? "Omar can be wrong. Check important answers."
              : "Noor is a study-motivation aid, not a therapist or medical service. In a crisis call your local emergency number."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── minimal empty state ─────────────────────────

/** Open-chat empty state. No persona cards, no hero visuals — just a
 *  serif greeting and a few prompt pills above the persistent composer. */
function EmptyChatState({ persona, onQuick }: { persona: AIPersona; onQuick: (text: string) => void }) {
  const prompts = persona === "omar" ? OMAR_PROMPTS : NOOR_PROMPTS;
  const greet = persona === "omar" ? "What are we learning today?" : "What's on your mind?";
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-2xl w-full mx-auto px-6 text-center">
        <h1 className="font-serif italic text-3xl md:text-5xl text-ink leading-[1.1]">
          {greet}
        </h1>
        <p className="mt-3 text-ink/55 text-sm md:text-base">
          Chatting with <span className="font-medium text-ink/80">{persona === "omar" ? "AI (Omar)" : "AI (Noor)"}</span>. I'll switch modes if the topic calls for it.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {prompts.map((p) => (
            <button
              key={p}
              onClick={() => onQuick(p)}
              className="h-9 px-3.5 rounded-full border border-ink/12 text-[13px] text-ink/75 hover:border-ink/35 hover:text-ink hover:bg-ink/5 transition"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── persona inference ─────────────────────────

const NOOR_KEYWORDS = [
  "anxious", "anxiety", "stressed", "stress", "overwhelm",
  "depressed", "depression", "sad", "lonely", "burnout", "burned out",
  "can't focus", "cant focus", "can't sleep", "cant sleep",
  "panic", "scared", "afraid", "worried", "hopeless",
  "tired", "exhausted", "drained", "motivation", "unmotivated",
  "confidence", "self-esteem", "self esteem",
  "relationship", "family", "breakup", "grief", "loss",
  "how do i cope", "i feel", "feeling",
];
const OMAR_KEYWORDS = [
  "solve", "prove", "calculate", "integrate", "derivative", "equation",
  "explain", "why does", "how does", "what is",
  "debug", "code", "syntax", "error", "compile", "function",
  "grammar", "translate", "conjugate",
  "plan", "schedule", "study", "exam", "midterm", "final",
  "homework", "assignment", "quiz", "practice",
  "formula", "theorem", "chapter",
];

/** Suggest a persona based on the message. Falls back to the current
 *  persona if nothing triggers — avoids flipping on ambiguous prose. */
function inferPersona(message: string, current: AIPersona): AIPersona {
  const text = message.toLowerCase();
  const hasNoor = NOOR_KEYWORDS.some(k => text.includes(k));
  const hasOmar = OMAR_KEYWORDS.some(k => text.includes(k));
  // Both or neither → keep the current persona, user didn't give us
  // a clear signal.
  if (hasNoor && !hasOmar) return "noor";
  if (hasOmar && !hasNoor) return "omar";
  return current;
}


// ───────────────────────── stream pieces ─────────────────────────

function PersonaToggle({ value, onChange }: { value: AIPersona; onChange: (p: AIPersona) => void }) {
  return (
    <div role="tablist" className="relative inline-flex items-center h-9 p-0.5 rounded-full bg-ink/6">
      <span
        className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-bg shadow-sm transition-transform"
        style={{ transform: value === "omar" ? "translateX(0)" : "translateX(100%)" }}
      />
      <button role="tab" aria-selected={value === "omar"} onClick={() => onChange("omar")}
        className={"relative z-10 h-8 px-4 rounded-full text-sm font-medium inline-flex items-center gap-1.5 transition " + (value === "omar" ? "text-ink" : "text-ink/55")}>
        <Brain size={14} /> Omar
      </button>
      <button role="tab" aria-selected={value === "noor"} onClick={() => onChange("noor")}
        className={"relative z-10 h-8 px-4 rounded-full text-sm font-medium inline-flex items-center gap-1.5 transition " + (value === "noor" ? "text-ink" : "text-ink/55")}>
        <Heart size={14} /> Noor
      </button>
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
  draft, setDraft, onKey, onSend, over, persona, onPickFile, fileRef, attachmentPresent,
}: {
  draft: string; setDraft: (s: string) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void; over: boolean; persona: AIPersona;
  onPickFile: (e: ChangeEvent<HTMLInputElement>) => void;
  fileRef: React.RefObject<HTMLInputElement>;
  attachmentPresent: boolean;
}) {
  return (
    <div className={`flex items-end gap-2 rounded-2xl border p-2 bg-bg transition ${over ? "border-ink/10 opacity-60" : "border-ink/15 focus-within:border-ink/35"}`}>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={over}
        className="w-10 h-10 shrink-0 rounded-full inline-flex items-center justify-center text-ink/60 hover:text-ink hover:bg-ink/5 transition"
      ><Plus size={18} /></button>
      <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" className="hidden" onChange={onPickFile} />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder={over ? "Daily limit reached — upgrade to continue" :
          persona === "omar" ? "Ask Omar anything…" : "Share what's on your mind…"}
        disabled={over}
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-ink placeholder:text-ink/40 px-1 py-2 max-h-36 leading-6"
      />
      <button
        onClick={onSend}
        disabled={over || (!draft.trim() && !attachmentPresent)}
        className="w-10 h-10 shrink-0 rounded-full bg-ink text-bg inline-flex items-center justify-center disabled:opacity-25 hover:bg-ink/85 transition"
      ><ArrowUp size={18} /></button>
    </div>
  );
}

function MessageRow({ msg }: { msg: AIMessage }) {
  if (msg.role === "user") return <UserMessage msg={msg} />;
  if (msg.role === "system") return <SystemNotice msg={msg} />;
  return <AIMessageView msg={msg} />;
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

function UserMessage({ msg }: { msg: AIMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-3xl rounded-br-lg bg-ink text-bg px-4 py-3">
        {msg.attachment && (
          <div className="mb-2 inline-flex items-center gap-2 h-8 px-2.5 rounded-full bg-bg/10 text-xs">
            <FileText size={12} />
            <span className="truncate max-w-[180px]">{msg.attachment.name}</span>
          </div>
        )}
        <p className="text-[15px] leading-[1.45] whitespace-pre-wrap">{msg.body}</p>
      </div>
    </div>
  );
}

function AIMessageView({ msg }: { msg: AIMessage }) {
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
          <div className="absolute inset-0"
            style={{ backgroundImage: bgUrl ? `url(${bgUrl})` : fallback, backgroundSize: "cover", backgroundPosition: "center", filter: "saturate(0.85)" }} aria-hidden />
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
                {msg.persona === "omar" ? "Omar" : "Noor"}
              </span>
              {msg.subject && msg.subject !== "general" && (
                <span className="text-white/80 text-[11px] uppercase tracking-wider" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>· {msg.subject}</span>
              )}
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
        {msg.artifact && <StudyPlanArtifact artifact={msg.artifact} />}
      </div>
    </div>
  );
}

function ThinkingRow({ persona }: { persona: AIPersona }) {
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

// ───────────────────────── helpers ─────────────────────────

function fileKind(name: string): "image" | "pdf" | "doc" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "doc";
}

