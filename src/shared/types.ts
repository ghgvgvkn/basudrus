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
  | "profile"
  | "notifications"
  | "settings"
  | "subscription"
  | "onboarding";

/** AI mode — Omar = Study, Noor = Mental Health. */
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
  /** Optional structured artifact — rendered by the AIScreen. */
  artifact?: StudyPlanArtifact;
  /** Optional attachment the user sent with this message. */
  attachment?: { name: string; kind: "image" | "pdf" | "doc"; url?: string };
}

export interface StudyPlanArtifact {
  kind: "studyPlan";
  title: string;
  days: {
    label: string; // e.g. "Mon Oct 14"
    blocks: { start: string; end: string; subject: string; kind: "study" | "break" | "class" | "sleep" }[];
  }[];
}

/** One conversation in the AI history drawer. */
export interface AIConversation {
  id: string;
  persona: AIPersona;
  preview: string;
  createdAt: string;
  messages: AIMessage[];
}
