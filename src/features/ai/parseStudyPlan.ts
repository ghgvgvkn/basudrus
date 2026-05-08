/**
 * parseStudyPlan — extract the AI-emitted <<<STUDY_PLAN>>> block
 * from an Omar reply, return the cleaned text + the parsed
 * StudyPlanArtifact so AIScreen can attach it to the message and
 * the artifact card renders premium.
 *
 * The AI is instructed (via system prompt) to emit this format when
 * the student asks for a schedule or study plan:
 *
 *   Some short prose explaining what's in the plan.
 *
 *   <<<STUDY_PLAN>>>
 *   {
 *     "title": "5-day Calc II midterm sprint",
 *     "examDate": "2026-05-15",
 *     "examLabel": "Calc II Midterm",
 *     "subtitle": "3 days to midterm — 9 hrs of focused study",
 *     "days": [
 *       {
 *         "label": "Mon May 12",
 *         "date": "2026-05-12",
 *         "blocks": [
 *           { "start": "16:00", "end": "17:30", "subject": "math",
 *             "kind": "study", "topic": "Past papers Ch 3-4" }
 *         ]
 *       }
 *     ]
 *   }
 *   <<<END_STUDY_PLAN>>>
 *
 * If the markers are missing, malformed, or the JSON is invalid, we
 * return the original text unchanged and artifact: null. The bubble
 * just renders the prose normally.
 *
 * Mid-stream: if the opener is present but the closer hasn't arrived
 * yet, we leave the body untouched (no flicker) and return null
 * artifact. Once the closer appears, we strip + parse on the next
 * render.
 */
import type { StudyPlanArtifact } from "@/shared/types";

export interface ParsedPlanReply {
  body: string;
  artifact: StudyPlanArtifact | null;
}

const OPEN_TAG = "<<<STUDY_PLAN>>>";
const CLOSE_TAG = "<<<END_STUDY_PLAN>>>";

/** Try to JSON.parse the block content tolerantly. The AI sometimes
 *  wraps the JSON in code fences (```json ... ```). Strip those. */
function tryParseJson(raw: string): unknown {
  let s = raw.trim();
  // Strip markdown code fence if present.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Validate + sanitize the parsed JSON into a clean StudyPlanArtifact.
 *  Returns null on invalid shape — better to drop the artifact than
 *  render garbage. */
function validateArtifact(raw: unknown): StudyPlanArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Title is required.
  if (typeof r.title !== "string" || !r.title.trim()) return null;
  // Days array required + non-empty.
  if (!Array.isArray(r.days) || r.days.length === 0) return null;

  const days: StudyPlanArtifact["days"] = [];
  for (const d of r.days) {
    if (!d || typeof d !== "object") continue;
    const dr = d as Record<string, unknown>;
    if (typeof dr.label !== "string" || !dr.label.trim()) continue;
    if (!Array.isArray(dr.blocks)) continue;
    const blocks: StudyPlanArtifact["days"][number]["blocks"] = [];
    for (const b of dr.blocks) {
      if (!b || typeof b !== "object") continue;
      const br = b as Record<string, unknown>;
      if (typeof br.start !== "string" || typeof br.end !== "string") continue;
      if (typeof br.subject !== "string") continue;
      const kind = br.kind === "break" || br.kind === "class" || br.kind === "sleep" || br.kind === "exam"
        ? br.kind
        : "study";
      blocks.push({
        start: br.start.slice(0, 5),
        end: br.end.slice(0, 5),
        subject: br.subject.slice(0, 60),
        kind,
        topic: typeof br.topic === "string" ? br.topic.slice(0, 200) : undefined,
      });
    }
    if (blocks.length === 0) continue;
    days.push({
      label: dr.label.slice(0, 60),
      date: typeof dr.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dr.date) ? dr.date : undefined,
      blocks,
    });
  }
  if (days.length === 0) return null;

  return {
    kind: "studyPlan",
    title: r.title.slice(0, 200),
    examDate: typeof r.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.examDate) ? r.examDate : undefined,
    examLabel: typeof r.examLabel === "string" ? r.examLabel.slice(0, 200) : undefined,
    subtitle: typeof r.subtitle === "string" ? r.subtitle.slice(0, 280) : undefined,
    totalStudyHours: typeof r.totalStudyHours === "number" && Number.isFinite(r.totalStudyHours)
      ? Math.max(0, Math.min(200, r.totalStudyHours))
      : undefined,
    days,
  };
}

export function parseStudyPlan(raw: string): ParsedPlanReply {
  if (!raw || typeof raw !== "string") {
    return { body: raw ?? "", artifact: null };
  }
  const openIdx = raw.indexOf(OPEN_TAG);
  if (openIdx === -1) return { body: raw, artifact: null };

  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
  if (closeIdx === -1) {
    // Mid-stream — block isn't closed yet. Leave the body untouched
    // so we don't flicker the bubble. Once the closer arrives the
    // next render picks it up and replaces with the artifact.
    return { body: raw, artifact: null };
  }

  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx);
  const before = raw.slice(0, openIdx).trimEnd();
  const after = raw.slice(closeIdx + CLOSE_TAG.length).trimStart();
  const cleanedBody = [before, after].filter(Boolean).join("\n\n");

  const parsed = tryParseJson(inner);
  const artifact = validateArtifact(parsed);
  if (!artifact) {
    // JSON unparseable / shape invalid. Strip the markers from the
    // visible body anyway so the student doesn't see raw `<<<STUDY_PLAN>>>`
    // tags, but skip the artifact render.
    return { body: cleanedBody, artifact: null };
  }
  return { body: cleanedBody, artifact };
}
