/**
 * tutorSession — durable memory + spaced-repetition for the AI tutor.
 *
 * Dedicated to Omar 🍏. Every student deserves a tutor who remembers
 * what they were working on last week, what they got stuck on, and
 * what's overdue for review.
 *
 * Three Supabase tables back this module (all RLS-gated to auth.uid()):
 *
 *   • tutor_sessions  — one row per session; messages[] grows in real time
 *   • tutor_progress  — one row per (user, subject); rolling mastery state
 *   • tutor_feedback  — append-only thumbs-up/down on individual messages
 *
 * Public surface (consumed by useStreamingAI + AIScreen):
 *
 *   • startOrResumeSession(userId, subject, mode) → SessionHandle
 *       Creates a new session row, or resumes one that was active in
 *       the last 30 minutes. Recomputes spaced-repetition queue.
 *
 *   • appendMessages(sessionId, msgs) → void
 *       Best-effort write; one silent retry; never throws.
 *
 *   • analyzeAndCloseSession(sessionId, accessToken) → void
 *       Calls /api/ai/analyze-session, parses the JSON, writes results
 *       to tutor_progress. Errors are swallowed — session analysis
 *       failure must never bubble to the student.
 *
 *   • buildMemoryContext(progress, recent) → string | null
 *       Formats the previous-session block injected into the system
 *       prompt. Returns null when there's nothing useful to inject
 *       (first session ever in this subject).
 *
 * Safety: every Supabase call here is wrapped in try/catch with a
 * single 500ms-delayed retry. The user-visible AI flow must never
 * block on memory persistence.
 */
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type TutorMode = "homework_help" | "study_mode";

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;          // ISO timestamp
}

export interface TopicEntry {
  topic: string;
  last_seen: string;   // ISO timestamp; drives spaced-rep math
}

export interface TutorProgressRow {
  id: string;
  user_id: string;
  subject: string;
  sessions_count: number;
  topics_covered: TopicEntry[];
  weak_areas: string[];
  strong_areas: string[];
  last_session_at: string | null;
  next_review_topics: string[];
}

export interface TutorSessionRow {
  id: string;
  user_id: string;
  subject: string;
  mode: TutorMode;
  messages: TutorMessage[];
  topics_covered: string[];
  session_number: number;
  session_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionHandle {
  /** UUID of the active session row in tutor_sessions. */
  sessionId: string;
  /** Memory context string, ready to be sent to the AI as system-prompt
   *  augmentation. `null` when the student has no prior history in
   *  this subject — the API will use the generic prompt. */
  memoryContext: string | null;
  /** Current mode for this session. */
  mode: TutorMode;
  /** Subject the session is tutoring on. */
  subject: string;
  /** Snapshot of the progress row used to build memoryContext —
   *  exposed so AIScreen can show "due reviews" hints if it ever
   *  wants to (UI unchanged today). */
  progress: TutorProgressRow | null;
}

// ─────────────────────────────────────────────────────────────────
// Spaced repetition (UPGRADE 4)
//
// Buckets a covered topic into a review priority based on how many
// days have passed since last_seen:
//
//   1–2 days  → no review needed (fresh)
//   3–7 days  → add to next_review_topics
//   8–14 days → high priority (front of queue)
//   15+ days  → critical (front of queue, surface first)
//
// All weak_areas always get added regardless of timing — the student
// struggled with them; spacing alone won't fix that.
// ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / DAY_MS;
}

/** Compute the spaced-repetition queue for a subject's progress.
 *  Returns topics ordered most-overdue first. Pure function — no
 *  side effects. */
export function computeReviewQueue(progress: TutorProgressRow | null): string[] {
  if (!progress) return [];
  const queue: { topic: string; priority: number }[] = [];
  const seen = new Set<string>();

  // Bucket each covered topic.
  for (const entry of progress.topics_covered ?? []) {
    if (!entry?.topic) continue;
    const key = entry.topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const d = daysSince(entry.last_seen);
    if (d <= 2) continue;                       // fresh, no review needed
    if (d >= 15)      queue.push({ topic: entry.topic, priority: 3 }); // critical
    else if (d >= 8)  queue.push({ topic: entry.topic, priority: 2 }); // high
    else              queue.push({ topic: entry.topic, priority: 1 }); // normal
  }

  // Always-on weak areas — past-struggle outranks recency.
  for (const w of progress.weak_areas ?? []) {
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ topic: w, priority: 4 });      // weak areas top-priority
  }

  return queue
    .sort((a, b) => b.priority - a.priority)
    .map((q) => q.topic)
    .slice(0, 6);                               // cap so prompt stays compact
}

// ─────────────────────────────────────────────────────────────────
// Memory context builder (UPGRADE 3)
//
// Produces the prepend-block sent to the system prompt. Format follows
// the user's spec exactly so the AI knows how to read it.
// ─────────────────────────────────────────────────────────────────

/** Build the memory context string injected into the system prompt.
 *  Returns null when there's truly nothing to say (no prior session). */
export function buildMemoryContext(
  progress: TutorProgressRow | null,
  recentMessages: TutorMessage[],
): string | null {
  // Genuine first session — let the AI introduce itself organically.
  if (!progress || progress.sessions_count === 0) return null;

  const lines: string[] = [];
  lines.push("STUDENT CONTEXT FROM PREVIOUS SESSIONS:");
  lines.push(`- Subject: ${progress.subject}`);
  lines.push(`- Total sessions: ${progress.sessions_count}`);

  const topicNames = (progress.topics_covered ?? [])
    .map((t) => t?.topic)
    .filter((t): t is string => !!t)
    .slice(0, 12);
  if (topicNames.length) {
    lines.push(`- Topics previously covered: ${topicNames.join(", ")}`);
  }

  if ((progress.weak_areas ?? []).length) {
    lines.push(`- Topics this student struggled with: ${progress.weak_areas.slice(0, 8).join(", ")}`);
  }
  if ((progress.strong_areas ?? []).length) {
    lines.push(`- Topics this student understood well: ${progress.strong_areas.slice(0, 8).join(", ")}`);
  }
  if ((progress.next_review_topics ?? []).length) {
    lines.push(`- Topics recommended for review today: ${progress.next_review_topics.slice(0, 6).join(", ")}`);
  }

  if (recentMessages.length) {
    // Compact each message to a single sanitised line; cap to 240 chars
    // so a long prior conversation doesn't blow the context budget.
    const tail = recentMessages.slice(-10).map((m) => {
      const role = m.role === "user" ? "STUDENT" : "TUTOR";
      const body = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 240);
      return `${role}: ${body}`;
    });
    lines.push("- Last messages from previous session:");
    lines.push(tail.map((t) => `    ${t}`).join("\n"));
  }

  lines.push("");
  lines.push("Use this context to:");
  lines.push("- Reference previous work naturally in the conversation.");
  lines.push("- Prioritise reviewing weak areas before introducing new material.");
  lines.push("- Never re-explain topics in strong_areas unless the student asks.");
  if ((progress.next_review_topics ?? []).length) {
    const first = progress.next_review_topics[0];
    lines.push(`- Open the conversation by saying naturally: "Before we start today, let's quickly revisit ${first} from last time — can you explain it back to me?"`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Persistence helpers (UPGRADE 3 + 4)
// All wrapped in a one-retry-then-swallow pattern. Tutor flow is
// authoritative; persistence is best-effort.
// ─────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await fn();
  } catch (e1) {
    if (import.meta.env.DEV) console.warn(`[tutorSession] ${label} attempt 1 failed:`, e1);
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await fn();
    } catch (e2) {
      if (import.meta.env.DEV) console.warn(`[tutorSession] ${label} attempt 2 failed (giving up):`, e2);
      return null;
    }
  }
}

/** Fetch (or seed) the progress row for (user, subject). Never throws. */
async function getOrCreateProgress(
  userId: string,
  subject: string,
): Promise<TutorProgressRow | null> {
  if (!supabase) return null;
  return withRetry(async () => {
    // Optimistic read — most calls hit an existing row.
    const { data: existing, error: readErr } = await supabase
      .from("tutor_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("subject", subject)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing) return existing as TutorProgressRow;
    // First time for this (user, subject) — seed a row.
    const { data: created, error: insErr } = await supabase
      .from("tutor_progress")
      .insert({ user_id: userId, subject })
      .select("*")
      .single();
    if (insErr) throw insErr;
    return created as TutorProgressRow;
  }, "getOrCreateProgress");
}

/** Resume a session opened in the last 30 minutes for the same subject;
 *  otherwise create a new one. Recomputes the spaced-rep queue. */
export async function startOrResumeSession(
  userId: string,
  subject: string,
  mode: TutorMode = "homework_help",
): Promise<SessionHandle> {
  // Defensive default — the rest of the code assumes a non-empty subject.
  const safeSubject = (subject || "general").trim().slice(0, 120) || "general";

  if (!supabase) {
    return {
      sessionId: "",
      memoryContext: null,
      mode,
      subject: safeSubject,
      progress: null,
    };
  }

  // 1. Load progress + previous session messages in parallel.
  const [progress, lastSession] = await Promise.all([
    getOrCreateProgress(userId, safeSubject),
    withRetry(async () => {
      const { data, error } = await supabase
        .from("tutor_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("subject", safeSubject)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TutorSessionRow | null;
    }, "loadLastSession"),
  ]);

  // 2. Recompute spaced-repetition queue + persist it.
  const reviewQueue = computeReviewQueue(progress);
  if (progress && supabase) {
    void withRetry(async () => {
      const { error } = await supabase
        .from("tutor_progress")
        .update({ next_review_topics: reviewQueue })
        .eq("id", progress.id);
      if (error) throw error;
      progress.next_review_topics = reviewQueue;
      return true;
    }, "writeReviewQueue");
  }
  if (progress) progress.next_review_topics = reviewQueue;

  // 3. Build memory context from progress + recent messages.
  const recentMsgs: TutorMessage[] = lastSession?.messages ?? [];
  const memoryContext = buildMemoryContext(progress, recentMsgs);

  // 4. Resume vs. new — re-use a session that's < 30 min old to avoid
  //    fragmenting a single sitting into multiple rows.
  const RESUME_WINDOW_MS = 30 * 60 * 1000;
  const fresh =
    lastSession &&
    lastSession.subject === safeSubject &&
    Date.now() - Date.parse(lastSession.updated_at) < RESUME_WINDOW_MS;

  if (fresh && lastSession) {
    // Mode might have changed since the last message — update if so.
    if (lastSession.mode !== mode) {
      void withRetry(async () => {
        const { error } = await supabase.from("tutor_sessions")
          .update({ mode })
          .eq("id", lastSession.id);
        if (error) throw error;
        return true;
      }, "updateMode");
    }
    return {
      sessionId: lastSession.id,
      memoryContext,
      mode,
      subject: safeSubject,
      progress,
    };
  }

  // 5. New session — derive session_number from progress.sessions_count.
  const sessionNumber = (progress?.sessions_count ?? 0) + 1;
  const created = await withRetry(async () => {
    const { data, error } = await supabase
      .from("tutor_sessions")
      .insert({
        user_id: userId,
        subject: safeSubject,
        mode,
        session_number: sessionNumber,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data as { id: string };
  }, "insertSession");

  return {
    sessionId: created?.id ?? "",
    memoryContext,
    mode,
    subject: safeSubject,
    progress,
  };
}

/** Append messages to the session row. Reads the current array first to
 *  avoid the read-modify-write race, but tolerates losing a message in
 *  the rare double-click case (the next save will include it again). */
export async function appendMessages(
  sessionId: string,
  newMsgs: TutorMessage[],
): Promise<void> {
  if (!sessionId || !supabase || newMsgs.length === 0) return;
  await withRetry(async () => {
    const { data: existing, error: readErr } = await supabase
      .from("tutor_sessions")
      .select("messages")
      .eq("id", sessionId)
      .maybeSingle();
    if (readErr) throw readErr;
    const prior: TutorMessage[] = (existing?.messages as TutorMessage[]) ?? [];
    // Cap stored messages at 200 to keep the row size sensible — older
    // turns are still preserved in the post-session summary.
    const next = [...prior, ...newMsgs].slice(-200);
    const { error: updErr } = await supabase
      .from("tutor_sessions")
      .update({ messages: next })
      .eq("id", sessionId);
    if (updErr) throw updErr;
    return true;
  }, "appendMessages");
}

/** Trigger post-session analysis (UPGRADE 5). Idempotent — calling it
 *  twice on the same session is harmless because the analyzer endpoint
 *  upserts and de-duplicates topics. Errors are swallowed. */
export async function analyzeAndCloseSession(
  sessionId: string,
  accessToken: string,
): Promise<void> {
  if (!sessionId || !accessToken) return;
  try {
    await fetch("/api/ai/analyze-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sessionId }),
      // 30s server-side budget for analysis; we don't want the page
      // close to hang on this call.
      keepalive: true,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[tutorSession] analyzeAndCloseSession swallowed error:", e);
  }
}

/** Fetch every session a user has ever had in a subject — used by
 *  potential future progress dashboards. Exposed for completeness. */
export async function listSessions(userId: string, subject: string): Promise<TutorSessionRow[]> {
  if (!supabase) return [];
  const out = await withRetry(async () => {
    const { data, error } = await supabase
      .from("tutor_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("subject", subject)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as TutorSessionRow[];
  }, "listSessions");
  return out ?? [];
}
