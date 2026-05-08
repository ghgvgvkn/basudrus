/**
 * parseRelationshipMessage — extract the AI-emitted
 * <<<RELATIONSHIP_MESSAGE>>> block from a Noor reply, return the
 * cleaned body + parsed RelationshipMessageArtifact.
 *
 * Format Noor emits:
 *
 *   Short framing — explain what kind of message + when to send +
 *   what to expect.
 *
 *   <<<RELATIONSHIP_MESSAGE>>>
 *   {
 *     "kind": "relationshipMessage",
 *     "recipient": "Yousef",
 *     "channel": "whatsapp",
 *     "messageType": "goodbye",
 *     "body": "Hey — I've been thinking about us...",
 *     "tone": "compassionate",
 *     "lang": "en",
 *     "coachingNote": "Send when you're calm, not at 2 AM...",
 *     "riskNote": "He may react with rage. That's not a sign you wrote it wrong.",
 *     "suggestSleepOnIt": true
 *   }
 *   <<<END_RELATIONSHIP_MESSAGE>>>
 *
 * Mid-stream / malformed handling matches parseStudyPlan +
 * parseProfessorEmail: incomplete blocks leave body untouched
 * (no flicker), invalid JSON strips markers but renders body.
 */
import type { RelationshipMessageArtifact } from "@/shared/types";

export interface ParsedRelMessageReply {
  body: string;
  artifact: RelationshipMessageArtifact | null;
}

const OPEN_TAG = "<<<RELATIONSHIP_MESSAGE>>>";
const CLOSE_TAG = "<<<END_RELATIONSHIP_MESSAGE>>>";

const VALID_CHANNELS: RelationshipMessageArtifact["channel"][] = [
  "whatsapp", "imessage", "instagram_dm", "in_person", "email", "other",
];
const VALID_TYPES: RelationshipMessageArtifact["messageType"][] = [
  "general", "boundary_setting", "goodbye", "family_conversation", "apology", "checkin",
];
const VALID_TONES: RelationshipMessageArtifact["tone"][] = [
  "warm", "direct", "firm", "compassionate",
];

function tryParseJson(raw: string): unknown {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(s); } catch { return null; }
}

function validateArtifact(raw: unknown): RelationshipMessageArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.recipient !== "string" || !r.recipient.trim()) return null;
  if (typeof r.body !== "string" || !r.body.trim()) return null;

  const channel = (VALID_CHANNELS as readonly string[]).includes(r.channel as string)
    ? (r.channel as RelationshipMessageArtifact["channel"])
    : "other";
  const messageType = (VALID_TYPES as readonly string[]).includes(r.messageType as string)
    ? (r.messageType as RelationshipMessageArtifact["messageType"])
    : "general";
  const tone = (VALID_TONES as readonly string[]).includes(r.tone as string)
    ? (r.tone as RelationshipMessageArtifact["tone"])
    : "warm";
  const lang = r.lang === "ar" ? "ar" : "en";

  return {
    kind: "relationshipMessage",
    recipient: r.recipient.slice(0, 120),
    channel,
    messageType,
    body: r.body.slice(0, 4000),
    tone,
    lang,
    coachingNote: typeof r.coachingNote === "string" ? r.coachingNote.slice(0, 800) : undefined,
    riskNote: typeof r.riskNote === "string" ? r.riskNote.slice(0, 400) : undefined,
    suggestSleepOnIt: r.suggestSleepOnIt === true,
  };
}

export function parseRelationshipMessage(raw: string): ParsedRelMessageReply {
  if (!raw || typeof raw !== "string") {
    return { body: raw ?? "", artifact: null };
  }
  const openIdx = raw.indexOf(OPEN_TAG);
  if (openIdx === -1) return { body: raw, artifact: null };

  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
  if (closeIdx === -1) {
    // Mid-stream — leave body untouched (no flicker mid-stream).
    return { body: raw, artifact: null };
  }

  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx);
  const before = raw.slice(0, openIdx).trimEnd();
  const after = raw.slice(closeIdx + CLOSE_TAG.length).trimStart();
  const cleanedBody = [before, after].filter(Boolean).join("\n\n");

  const parsed = tryParseJson(inner);
  const artifact = validateArtifact(parsed);
  if (!artifact) return { body: cleanedBody, artifact: null };
  return { body: cleanedBody, artifact };
}
