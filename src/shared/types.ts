/**
 * Shared types for the redesign. Kept deliberately small — the full
 * `Profile` type lives in the legacy repo at `src/lib/types.ts`; this
 * file re-exports only the shapes the new screens need, plus the
 * screen-id enum.
 */

export type ScreenId =
  | "home"
  | "discover"
  | "ai"
  | "connect"
  | "rooms"
  | "pastPapers"
  | "studyMatch"
  | "profile"
  | "notifications"
  | "settings"
  | "subscription"
  | "onboarding";

/** AI mode — Tony Starrk = Study, Sherlock = Mental Health. */
export type AIPersona = "omar" | "noor";

/** Subscription tier. */
export type Tier = "free" | "pro";

export interface Subscription {
  tier: Tier;
  /** Free tier: messages remaining today. Pro: Infinity. */
  aiQuota: number;
  aiCap: number; // 30 for free, Infinity for pro
  /** ISO — when the current free-tier daily bucket resets. */
  resetsAt: string;
  /** Pro only. */
  renewsAt?: string;
  paymentLast4?: string;
}

/** Personality quiz answers from onboarding. 5 axes. */
export interface PersonalityAnswers {
  solo_vs_group: "solo" | "group" | "both";
  morning_vs_night: "morning" | "night" | "flexible";
  verbal_vs_visual: "verbal" | "visual" | "both";
  pace: "slow" | "steady" | "fast";
  structure: "loose" | "structured";
}

/** Minimal user profile — expand as screens need more fields. */
export interface Profile {
  id: string;
  name: string;
  uni: string | null;
  major: string | null;
  year: number | null;
  bio: string | null;
  interests: string[] | null;
  avatar_color: string | null;
  /** "avatar" (use initials + color) or "photo" (use photo_url). */
  photo_mode?: "avatar" | "photo";
  photo_url?: string | null;
  /** Points/streak surfaced on profile cards. */
  points?: number;
  streak?: number;
  /** Populated by useAuth hydration; not a DB column. */
  email?: string;
}

/** Match candidate returned by useDiscover. Score 0–100. */
export interface MatchCandidate extends Profile {
  score: number;
  reasons: string[];
}

/** Conversation summary shown in Connect list. */
export interface ConversationSummary {
  id: string;
  partner: Profile;
  lastMessage: string;
  lastAt: string; // ISO
  unread: number;
}

/** Single chat message. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: string;
  /** For AI chats only — one of the four personas. */
  persona?: "tutor" | "wellbeing" | "planner" | "match";
}

/** Study room / group. */
export interface Room {
  id: string;
  name: string;
  subject: string;
  host_id: string;
  members: string[];
  size_cap: number | null;
  when: string | null; // ISO
  place: string | null;
  description: string | null;
}

/** Notification row. */
export interface Notif {
  id: string;
  kind: "match" | "message" | "room" | "system";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  actorId?: string;
  targetId?: string;
}

/** @deprecated — use AIPersona. Kept for back-compat during rename. */
export type AIMode = "tutor" | "wellbeing" | "planner" | "match";

/** Subject family inferred from the question. Drives the per-message
 *  3D artifact's *geometry* (math → fractals, bio → cells, etc.).
 *  Palette stays keyed to persona. */
export type AISubject =
  | "math"
  | "biology"
  | "chemistry"
  | "physics"
  | "languages"
  | "history"
  | "cs"
  | "wellbeing"
  | "general";

/** A single file attached to a user message (one of N — see `attachments`). */
export interface AIAttachment {
  name: string;
  kind: "image" | "pdf" | "doc";
  url?: string;
  /** When kind === "pdf": metadata extracted client-side and used
   *  to render the smart book preview card in the user bubble. */
  pdfMeta?: {
    pageCount: number;
    characterCount: number;
    truncated: boolean;
    /** Optional document title from PDF metadata (Info dict). */
    title?: string | null;
    /** Optional author from PDF metadata. */
    author?: string | null;
    /** Optional friendly producer label — "Microsoft Word", "LaTeX", "Google Docs". */
    producer?: string | null;
  };
}

/** One message in an AI thread. Server writes these once the real
 *  useAI() hook is wired; for the bundle they live in local state. */
export interface AIMessage {
  id: string;
  /** "system" = auto-switch notices, quota-reset banners, etc. Rendered
   *  inline as a small centered chip, not a full message bubble. */
  role: "user" | "ai" | "system";
  persona: AIPersona;
  body: string;
  createdAt: string;
  /** Subject inference. AI messages set this; user messages may omit. */
  subject?: AISubject;
  /** Optional structured artifact — rendered by the AIScreen. The
   *  artifact union expands as we add more types (study plans,
   *  professor emails, CVs, etc.). The renderer dispatches on
   *  artifact.kind. */
  artifact?: StudyPlanArtifact | ProfessorEmailArtifact | RelationshipMessageArtifact | CvArtifact;
  /** Single attachment the user sent with this message — LEGACY field
   *  preserved for older messages persisted to chat_history before the
   *  multi-file refactor. New code reads `attachments` (plural) which
   *  is always at least a single-element array when files are present. */
  attachment?: AIAttachment;
  /** All attachments (1..N) the user sent with this message. Up to 5
   *  files can be attached in one turn (images + PDFs mixed). When this
   *  is set, renderers iterate it; otherwise they fall back to the
   *  singular `attachment` field for legacy messages. */
  attachments?: AIAttachment[];
  /** When set, renders the system message as a two-button switch
   *  suggestion ("Switch to X" / "Stay with Y") instead of the
   *  small centered chip. Used to let the user EXPLICITLY choose
   *  whether to switch personas instead of forcing it on them. */
  switchSuggestion?: {
    suggested: AIPersona;
    current: AIPersona;
  };
  /** Tappable quick-reply chips extracted from a `<<<OPTIONS>>>` block
   *  in the AI's response. Rendered below the AI bubble; tapping a
   *  chip sends that exact text as the student's next message. The
   *  AI emits this block whenever it asks a question that has 3–5
   *  reasonable typical answers, so students don't have to type. */
  quickReplies?: string[];
}

export interface StudyPlanArtifact {
  kind: "studyPlan";
  /** Plan title — e.g. "5-day Calc II midterm sprint". */
  title: string;
  /** Optional ISO date of the exam this plan is for (YYYY-MM-DD).
   *  Drives the countdown badge in the redesigned artifact card. */
  examDate?: string;
  /** Optional human label for what's at the END of this plan
   *  ("Calc II Midterm", "Final Exam Week"). */
  examLabel?: string;
  /** Optional one-line subtitle — appears under the title.
   *  e.g. "3 days to midterm — 9 hrs of focused study". */
  subtitle?: string;
  /** Total study hours summed across days, optional. */
  totalStudyHours?: number;
  days: {
    /** Display label, e.g. "Mon Oct 14". */
    label: string;
    /** Optional ISO date (YYYY-MM-DD) — used by the .ics export to
     *  emit real calendar events. */
    date?: string;
    blocks: {
      /** "HH:MM" 24-hour. */
      start: string;
      /** "HH:MM" 24-hour. */
      end: string;
      /** Subject key — preferably one of the AISubject values so the
       *  card can color-code via subjectPalette. Free-form strings
       *  are tolerated and fall back to the "general" palette. */
      subject: string;
      kind: "study" | "break" | "class" | "sleep" | "exam";
      /** Optional focus for this block ("Past papers Ch 3-5"). */
      topic?: string;
    }[];
  }[];
}

/** Day 14 — drafted email to a professor (or TA, advisor, dean,
 *  scholarship office, etc.). Rendered as a premium card with the
 *  subject line, body, and copy / open-in-mail-app actions. */
export interface ProfessorEmailArtifact {
  kind: "professorEmail";
  /** Recipient header — typically "Dr. <FamilyName>" / "د. <اسم العائلة>".
   *  Jordanian academic norms: "Dr." is the universal address for
   *  any PhD-holder, regardless of faculty rank. */
  recipient: string;
  /** Email subject line (concise, <8 words ideally). */
  subject: string;
  /** Body — plain text with line breaks preserved. The renderer
   *  shows it in a monospace-readable card the student can copy
   *  verbatim. */
  body: string;
  /** Sign-off including the student's name. If the AI doesn't know
   *  the student's name yet, it uses "[your name]" so the student
   *  sees the placeholder and replaces it. */
  signOff: string;
  /** Language of the email. Drives copy direction (LTR/RTL) and
   *  the localized "Copy" / "Open in mail" labels. */
  lang: "en" | "ar";
  /** Tone tier the AI selected. Surfaces as a small tag in the card
   *  header so the student knows which dial they're on and can ask
   *  for a different tone. */
  tone: "formal" | "respectful_warm" | "casual_respectful";
  /** Optional one-paragraph coaching note from Tony Starrk — WHY he wrote
   *  it this way, what to watch out for, what to do if the prof
   *  rejects. Rendered below the card in subdued text, NOT inside
   *  the email body the student copies. */
  coachingNote?: string;
}

/** Day 16 — drafted message Sherlock helps the student send to someone
 *  in their life (partner, friend, family). NOT real-time mediation.
 *  Student copies / sends themselves. Strong safeguards apply on the
 *  prompt side: Sherlock refuses to draft when abuse signals, manipulation
 *  intent, or out-of-scope requests are detected. */
export interface RelationshipMessageArtifact {
  kind: "relationshipMessage";
  /** Recipient — first name or descriptor ("Mom", "Yousef",
   *  "my best friend Layla"). */
  recipient: string;
  /** Channel — drives the icon + label, NOT auto-send. The student
   *  always copies and pastes themselves. */
  channel: "whatsapp" | "imessage" | "instagram_dm" | "in_person" | "email" | "other";
  /** Type of message. Determines the drafting style + which
   *  safeguards / coaching notes apply. */
  messageType: "general" | "boundary_setting" | "goodbye" | "family_conversation" | "apology" | "checkin";
  /** The drafted message body. For "in_person" channel this is a
   *  conversation OUTLINE / talking points, not a single message. */
  body: string;
  /** Tone tier — warm (light, friendly), direct (clear, plain),
   *  firm (boundary-style, non-negotiable), compassionate (heavy
   *  topic, soft delivery). */
  tone: "warm" | "direct" | "firm" | "compassionate";
  /** Language — drives copy direction (LTR/RTL) + localized labels. */
  lang: "en" | "ar";
  /** Coaching note from Sherlock — when to send, what to expect, what
   *  to do if reaction is bad. Lives BELOW the card so it doesn't
   *  get copied accidentally. */
  coachingNote?: string;
  /** Optional explicit RISK note — used for high-stakes types
   *  (goodbye, boundary_setting). Surfaced prominently in the card
   *  so the student sees the risk before sending. */
  riskNote?: string;
  /** Optional 24-hour soft delay suggestion — Sherlock sets this for
   *  high-emotion drafts so the student is reminded to sleep on it. */
  suggestSleepOnIt?: boolean;
}

/** Day 17 — CV / résumé Tony Starrk drafts for a student. The artifact
 *  is structured so the renderer can format sections cleanly AND
 *  the "copy as plain text" button produces a CV the student can
 *  paste into Word / Google Docs / LinkedIn / job forms.
 *
 *  Format mode matters in Jordan — "jordanian" keeps personal info
 *  + photo + 2 pages OK; "western" / "ats_friendly" omits photo,
 *  keeps strict 1 page, no personal details beyond email/phone. */
export interface CvArtifact {
  kind: "cv";
  /** Render mode — affects layout decisions and which sections are
   *  emphasized.
   *    "jordanian"     → photo OK (we don't render one), longer is
   *                      fine, location / nationality common.
   *    "western"       → 1 page, no photo, no DOB / marital status.
   *    "ats_friendly"  → flat structure, simple section names,
   *                      no fancy formatting; survives applicant
   *                      tracking systems intact.
   */
  renderMode: "jordanian" | "western" | "ats_friendly";
  /** Language. */
  lang: "en" | "ar";
  /** Personal info — every field optional except fullName. */
  personal: {
    fullName: string;
    title?: string;          // "Computer Science Student" / "Software Engineer"
    email?: string;
    phone?: string;
    location?: string;       // "Amman, Jordan"
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  /** Optional 2-3 line summary / objective. Skip when there's
   *  nothing meaningful — generic summaries are filler. */
  summary?: string;
  /** Education entries — most important section for students. */
  education: Array<{
    institution: string;
    degree: string;          // "BSc in Computer Science"
    location?: string;
    startDate?: string;      // "Sep 2022"
    endDate?: string;        // "Expected May 2026" or "May 2024"
    gpa?: string;            // Only when ≥ 3.0/4.0 or ≥ 80% — see prompt
    relevantCoursework?: string[];
    honors?: string[];
  }>;
  /** Work / internship experience. Empty array OK for first-CV. */
  experience: Array<{
    title: string;
    organization: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    /** Action-verb bullets with quantification when possible. */
    bullets: string[];
  }>;
  /** Projects — critical for STEM students with no work xp. */
  projects: Array<{
    name: string;
    techStack?: string[];
    role?: string;
    bullets: string[];
    url?: string;
  }>;
  /** Skills — categorized, kept compact. */
  skills: {
    technical?: string[];
    languages?: Array<{ name: string; level: string }>;  // e.g. { name: "Arabic", level: "Native" }
    soft?: string[];
    tools?: string[];
  };
  /** Activities, volunteer work, leadership. Optional. */
  activities?: Array<{
    role: string;
    organization: string;
    startDate?: string;
    endDate?: string;
    bullets?: string[];
  }>;
  /** Certifications, awards. Optional. */
  certifications?: Array<{
    name: string;
    issuer?: string;
    date?: string;
  }>;
  /** Coaching note from Tony Starrk — what's strong, what's weak, what
   *  to add as the student gains experience. Lives below the card. */
  coachingNote?: string;
}

/** One conversation in the AI history drawer. */
export interface AIConversation {
  id: string;
  persona: AIPersona;
  preview: string;
  createdAt: string;
  messages: AIMessage[];
}
