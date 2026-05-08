/**
 * parseProfessorEmail — extract the AI-emitted <<<PROFESSOR_EMAIL>>>
 * block from an Omar reply, return the cleaned body + parsed
 * ProfessorEmailArtifact so the AIScreen can attach it to the
 * message and the renderer shows a premium copy-pasteable card.
 *
 * The format Omar emits:
 *
 *   Short prose framing the email + any honest caveats.
 *
 *   <<<PROFESSOR_EMAIL>>>
 *   {
 *     "kind": "professorEmail",
 *     "recipient": "Dr. Khalil",
 *     "subject": "Request for extension — CS340 project",
 *     "body": "Dear Dr. Khalil,\n\nI'm writing about the...",
 *     "signOff": "Best regards,\nAhmed Al-Dulaimi (CS340-A)",
 *     "lang": "en",
 *     "tone": "respectful_warm",
 *     "coachingNote": "Send within 24 hours of the missed deadline..."
 *   }
 *   <<<END_PROFESSOR_EMAIL>>>
 *
 * Mid-stream and malformed handling matches parseStudyPlan: incomplete
 * blocks leave the body untouched (no flicker), invalid JSON strips
 * the markers but renders body as-is.
 */
import type { ProfessorEmailArtifact } from "@/shared/types";

export interface ParsedEmailReply {
  body: string;
  artifact: ProfessorEmailArtifact | null;
}

const OPEN_TAG = "<<<PROFESSOR_EMAIL>>>";
const CLOSE_TAG = "<<<END_PROFESSOR_EMAIL>>>";

function tryParseJson(raw: string): unknown {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(s); } catch { return null; }
}

function validateArtifact(raw: unknown): ProfessorEmailArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.subject !== "string" || !r.subject.trim()) return null;
  if (typeof r.body !== "string" || !r.body.trim()) return null;
  if (typeof r.recipient !== "string" || !r.recipient.trim()) return null;
  if (typeof r.signOff !== "string" || !r.signOff.trim()) return null;
  // Tone — fall back to "respectful_warm" if missing or unknown.
  const tone =
    r.tone === "formal" || r.tone === "respectful_warm" || r.tone === "casual_respectful"
      ? r.tone
      : "respectful_warm";
  // Language — fall back to en if missing.
  const lang = r.lang === "ar" ? "ar" : "en";
  return {
    kind: "professorEmail",
    recipient: r.recipient.slice(0, 200),
    subject: r.subject.slice(0, 200),
    body: r.body.slice(0, 5000),
    signOff: r.signOff.slice(0, 400),
    lang,
    tone,
    coachingNote: typeof r.coachingNote === "string" ? r.coachingNote.slice(0, 800) : undefined,
  };
}

export function parseProfessorEmail(raw: string): ParsedEmailReply {
  if (!raw || typeof raw !== "string") {
    return { body: raw ?? "", artifact: null };
  }
  const openIdx = raw.indexOf(OPEN_TAG);
  if (openIdx === -1) return { body: raw, artifact: null };

  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
  if (closeIdx === -1) {
    // Mid-stream — leave body untouched so the bubble doesn't flicker.
    return { body: raw, artifact: null };
  }

  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx);
  const before = raw.slice(0, openIdx).trimEnd();
  const after = raw.slice(closeIdx + CLOSE_TAG.length).trimStart();
  const cleanedBody = [before, after].filter(Boolean).join("\n\n");

  const parsed = tryParseJson(inner);
  const artifact = validateArtifact(parsed);
  if (!artifact) {
    // Markers stripped from visible body, but no artifact rendered.
    return { body: cleanedBody, artifact: null };
  }
  return { body: cleanedBody, artifact };
}
