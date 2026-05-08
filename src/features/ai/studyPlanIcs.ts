/**
 * studyPlanIcs — convert a StudyPlanArtifact to RFC 5545 iCalendar
 * (.ics) format so the student can import into Apple Calendar,
 * Google Calendar, Outlook, or anything else that speaks ICS.
 *
 * Why client-side: zero backend dependency, instant download, no
 * email round-trip needed for the calendar path. The student gets
 * a file in their Downloads in 50ms.
 *
 * Format constraints we care about:
 *   • Each VEVENT needs a UID (we generate a stable one from
 *     plan-title + day-date + start-time so re-importing the same
 *     plan replaces existing events instead of duplicating them).
 *   • Lines folded at 75 octets per RFC 5545 § 3.1 — most calendar
 *     apps tolerate longer, but Outlook is famously strict.
 *   • Text fields escape commas, semicolons, backslashes, newlines.
 *   • Times use TZID=Asia/Amman (Jordan) so the events land at the
 *     student's actual local clock time. Omitting TZID would default
 *     to UTC, which would shift everything by 3 hours.
 *
 * Limits:
 *   • If a day has no `date` set we skip its events (calendars need
 *     a real date). Day-only schedules render fine in the UI but
 *     don't export.
 *   • If the plan has an `examDate` we emit a final all-day VEVENT
 *     for the exam itself so it shows up clearly in the user's
 *     calendar week-view.
 */
import type { StudyPlanArtifact } from "@/shared/types";

const TZID = "Asia/Amman";

/** Escape a TEXT field per RFC 5545 § 3.3.11. */
function escText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/** Fold a line at 75 octets per RFC 5545 § 3.1. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const slice = line.slice(i, i + 75);
    out.push(i === 0 ? slice : ` ${slice}`); // continuation lines start with a single space
    i += 75;
  }
  return out.join("\r\n");
}

/** ICS date-time form: YYYYMMDDTHHMMSS (no TZ designator since we
 *  pair it with TZID=Asia/Amman in the property line). */
function icsDateTime(dateIso: string, timeHHMM: string): string {
  const [y, m, d] = dateIso.split("-");
  const [hh, mm] = timeHHMM.split(":");
  return `${y}${m}${d}T${hh.padStart(2, "0")}${mm.padStart(2, "0")}00`;
}

/** ICS date form (all-day events): YYYYMMDD. */
function icsDate(dateIso: string): string {
  return dateIso.replace(/-/g, "");
}

/** Stable UID — re-importing replaces, doesn't duplicate. */
function uidFor(plan: StudyPlanArtifact, dayDate: string, start: string, idx: number): string {
  const title = (plan.title || "study-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  return `${title}-${icsDate(dayDate)}-${start.replace(":", "")}-${idx}@basudrus.com`;
}

/** Friendly title for an event block. */
function blockTitle(block: StudyPlanArtifact["days"][number]["blocks"][number]): string {
  if (block.kind === "exam") return `📝 Exam — ${block.subject}`;
  if (block.kind === "class") return `🏫 Class — ${block.subject}`;
  if (block.kind === "break") return `☕ Break`;
  if (block.kind === "sleep") return `🌙 Sleep`;
  // study
  const subj = block.subject || "Study";
  return `📚 ${subj}${block.topic ? ` — ${block.topic}` : ""}`;
}

/** Build the full .ics document as a string. */
export function buildStudyPlanIcs(plan: StudyPlanArtifact): string {
  // DTSTAMP must be a valid UTC timestamp per RFC 5545 § 3.8.7.2.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bas Udrus//Study Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // Embed the Asia/Amman timezone definition inline so importing
    // calendars don't need to look it up. Includes both standard
    // and daylight rules — Jordan abolished DST in 2022 (year-round
    // UTC+3) but historical events may still need the rule.
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "TZNAME:EET",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  // Each block becomes a VEVENT.
  for (const day of plan.days) {
    if (!day.date) continue;
    day.blocks.forEach((block, idx) => {
      // Skip "sleep" blocks — most students don't want to clutter
      // their calendar with sleep events. Breaks too short to
      // matter we skip; breaks ≥30 min stay in.
      if (block.kind === "sleep") return;
      const dtStart = icsDateTime(day.date!, block.start);
      const dtEnd = icsDateTime(day.date!, block.end);
      const summary = blockTitle(block);
      const desc = block.topic
        ? `Focus: ${block.topic}\n\nFrom your Bas Udrus study plan: ${plan.title}`
        : `From your Bas Udrus study plan: ${plan.title}`;

      lines.push(
        "BEGIN:VEVENT",
        fold(`UID:${uidFor(plan, day.date!, block.start, idx)}`),
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${TZID}:${dtStart}`,
        `DTEND;TZID=${TZID}:${dtEnd}`,
        fold(`SUMMARY:${escText(summary)}`),
        fold(`DESCRIPTION:${escText(desc)}`),
        "END:VEVENT",
      );
    });
  }

  // Final all-day exam event if examDate is set.
  if (plan.examDate) {
    const examName = plan.examLabel || plan.title;
    // All-day event uses VALUE=DATE form, with DTEND = day after.
    const start = icsDate(plan.examDate);
    const endDateObj = new Date(plan.examDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endIso = `${endDateObj.getFullYear()}-${pad(endDateObj.getMonth() + 1)}-${pad(endDateObj.getDate())}`;
    const end = icsDate(endIso);
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:exam-${icsDate(plan.examDate)}-${escText(examName).slice(0, 30)}@basudrus.com`),
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      fold(`SUMMARY:${escText(`📝 ${examName}`)}`),
      fold(`DESCRIPTION:${escText("Exam day — your study plan from Bas Udrus is set up to land here.")}`),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // ICS spec requires CRLF line endings.
  return lines.join("\r\n");
}

/** Trigger a browser download of the .ics file. Idempotent — calling
 *  twice produces the same filename. */
export function downloadStudyPlanIcs(plan: StudyPlanArtifact): void {
  const ics = buildStudyPlanIcs(plan);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Sanitize the title for a filename: lowercase, hyphens only.
  const filename = `${(plan.title || "study-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "study-plan"}.ics`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so older browsers complete the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
