/**
 * parseCv — extract the AI-emitted <<<CV>>> block from an Tony Starrk
 * reply, return the cleaned body + parsed CvArtifact.
 *
 * Format Tony Starrk emits:
 *
 *   Short framing line — what mode + what's missing the student
 *   should add over time.
 *
 *   <<<CV>>>
 *   {
 *     "kind": "cv",
 *     "renderMode": "jordanian",
 *     "lang": "en",
 *     "personal": { "fullName": "...", "email": "...", ... },
 *     "summary": "...",
 *     "education": [...],
 *     "experience": [...],
 *     "projects": [...],
 *     "skills": { "technical": [...], "languages": [...], ... },
 *     "activities": [...],
 *     "certifications": [...],
 *     "coachingNote": "..."
 *   }
 *   <<<END_CV>>>
 *
 * Mid-stream / malformed handling matches the other parsers.
 */
import type { CvArtifact } from "@/shared/types";

export interface ParsedCvReply {
  body: string;
  artifact: CvArtifact | null;
}

const OPEN_TAG = "<<<CV>>>";
const CLOSE_TAG = "<<<END_CV>>>";

const VALID_MODES: CvArtifact["renderMode"][] = ["jordanian", "western", "ats_friendly"];

function tryParseJson(raw: string): unknown {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(s); } catch { return null; }
}

/** Coerce an unknown into a clean string array, dropping non-strings
 *  and capping each entry length. */
function safeStringArray(raw: unknown, perItemMax = 200, maxItems = 30): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, maxItems)
    .map((s) => s.slice(0, perItemMax));
}

/** Coerce an unknown into a clean entry array given a per-item
 *  validator. Drops invalid entries silently. */
function safeArrayOf<T>(raw: unknown, validate: (x: unknown) => T | null, max = 20): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const x of raw) {
    const v = validate(x);
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function validateArtifact(raw: unknown): CvArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // fullName is the only hard requirement — without a name, the CV
  // is meaningless.
  const personal = r.personal as Record<string, unknown> | undefined;
  if (!personal || typeof personal.fullName !== "string" || !personal.fullName.trim()) return null;

  const renderMode = (VALID_MODES as readonly string[]).includes(r.renderMode as string)
    ? (r.renderMode as CvArtifact["renderMode"])
    : "jordanian";
  const lang = r.lang === "ar" ? "ar" : "en";

  const safePersonal: CvArtifact["personal"] = {
    fullName: personal.fullName.slice(0, 120),
    title: typeof personal.title === "string" ? personal.title.slice(0, 120) : undefined,
    email: typeof personal.email === "string" ? personal.email.slice(0, 200) : undefined,
    phone: typeof personal.phone === "string" ? personal.phone.slice(0, 60) : undefined,
    location: typeof personal.location === "string" ? personal.location.slice(0, 120) : undefined,
    linkedin: typeof personal.linkedin === "string" ? personal.linkedin.slice(0, 200) : undefined,
    github: typeof personal.github === "string" ? personal.github.slice(0, 200) : undefined,
    portfolio: typeof personal.portfolio === "string" ? personal.portfolio.slice(0, 200) : undefined,
  };

  const education = safeArrayOf<CvArtifact["education"][number]>(r.education, (x) => {
    if (!x || typeof x !== "object") return null;
    const e = x as Record<string, unknown>;
    if (typeof e.institution !== "string" || typeof e.degree !== "string") return null;
    return {
      institution: e.institution.slice(0, 200),
      degree: e.degree.slice(0, 200),
      location: typeof e.location === "string" ? e.location.slice(0, 120) : undefined,
      startDate: typeof e.startDate === "string" ? e.startDate.slice(0, 60) : undefined,
      endDate: typeof e.endDate === "string" ? e.endDate.slice(0, 60) : undefined,
      gpa: typeof e.gpa === "string" ? e.gpa.slice(0, 40) : undefined,
      relevantCoursework: safeStringArray(e.relevantCoursework, 80, 12),
      honors: safeStringArray(e.honors, 200, 8),
    };
  }, 6);

  const experience = safeArrayOf<CvArtifact["experience"][number]>(r.experience, (x) => {
    if (!x || typeof x !== "object") return null;
    const e = x as Record<string, unknown>;
    if (typeof e.title !== "string" || typeof e.organization !== "string") return null;
    return {
      title: e.title.slice(0, 200),
      organization: e.organization.slice(0, 200),
      location: typeof e.location === "string" ? e.location.slice(0, 120) : undefined,
      startDate: typeof e.startDate === "string" ? e.startDate.slice(0, 60) : undefined,
      endDate: typeof e.endDate === "string" ? e.endDate.slice(0, 60) : undefined,
      bullets: safeStringArray(e.bullets, 280, 8),
    };
  }, 8);

  const projects = safeArrayOf<CvArtifact["projects"][number]>(r.projects, (x) => {
    if (!x || typeof x !== "object") return null;
    const p = x as Record<string, unknown>;
    if (typeof p.name !== "string") return null;
    return {
      name: p.name.slice(0, 200),
      techStack: safeStringArray(p.techStack, 60, 12),
      role: typeof p.role === "string" ? p.role.slice(0, 120) : undefined,
      bullets: safeStringArray(p.bullets, 280, 6),
      url: typeof p.url === "string" ? p.url.slice(0, 300) : undefined,
    };
  }, 8);

  const skillsRaw = (r.skills as Record<string, unknown> | undefined) ?? {};
  const skills: CvArtifact["skills"] = {
    technical: safeStringArray(skillsRaw.technical, 60, 30),
    languages: safeArrayOf<{ name: string; level: string }>(skillsRaw.languages, (x) => {
      if (!x || typeof x !== "object") return null;
      const l = x as Record<string, unknown>;
      if (typeof l.name !== "string" || typeof l.level !== "string") return null;
      return { name: l.name.slice(0, 60), level: l.level.slice(0, 40) };
    }, 6),
    soft: safeStringArray(skillsRaw.soft, 60, 12),
    tools: safeStringArray(skillsRaw.tools, 60, 30),
  };

  const activities = safeArrayOf<NonNullable<CvArtifact["activities"]>[number]>(r.activities, (x) => {
    if (!x || typeof x !== "object") return null;
    const a = x as Record<string, unknown>;
    if (typeof a.role !== "string" || typeof a.organization !== "string") return null;
    return {
      role: a.role.slice(0, 200),
      organization: a.organization.slice(0, 200),
      startDate: typeof a.startDate === "string" ? a.startDate.slice(0, 60) : undefined,
      endDate: typeof a.endDate === "string" ? a.endDate.slice(0, 60) : undefined,
      bullets: safeStringArray(a.bullets, 280, 5),
    };
  }, 6);

  const certifications = safeArrayOf<NonNullable<CvArtifact["certifications"]>[number]>(r.certifications, (x) => {
    if (!x || typeof x !== "object") return null;
    const c = x as Record<string, unknown>;
    if (typeof c.name !== "string") return null;
    return {
      name: c.name.slice(0, 200),
      issuer: typeof c.issuer === "string" ? c.issuer.slice(0, 200) : undefined,
      date: typeof c.date === "string" ? c.date.slice(0, 60) : undefined,
    };
  }, 12);

  return {
    kind: "cv",
    renderMode,
    lang,
    personal: safePersonal,
    summary: typeof r.summary === "string" ? r.summary.slice(0, 600) : undefined,
    education,
    experience,
    projects,
    skills,
    activities: activities.length > 0 ? activities : undefined,
    certifications: certifications.length > 0 ? certifications : undefined,
    coachingNote: typeof r.coachingNote === "string" ? r.coachingNote.slice(0, 1000) : undefined,
  };
}

export function parseCv(raw: string): ParsedCvReply {
  if (!raw || typeof raw !== "string") {
    return { body: raw ?? "", artifact: null };
  }
  const openIdx = raw.indexOf(OPEN_TAG);
  if (openIdx === -1) return { body: raw, artifact: null };
  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
  if (closeIdx === -1) return { body: raw, artifact: null };
  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx);
  const before = raw.slice(0, openIdx).trimEnd();
  const after = raw.slice(closeIdx + CLOSE_TAG.length).trimStart();
  const cleanedBody = [before, after].filter(Boolean).join("\n\n");

  const parsed = tryParseJson(inner);
  const artifact = validateArtifact(parsed);
  if (!artifact) return { body: cleanedBody, artifact: null };
  return { body: cleanedBody, artifact };
}

/** Convert a CV artifact into clean plain text the student can
 *  paste into Word, Google Docs, LinkedIn, or a job application
 *  form. Used by the "Copy as plain text" button on the renderer. */
export function cvToPlainText(cv: CvArtifact): string {
  const lines: string[] = [];
  const isAr = cv.lang === "ar";

  // Header
  lines.push(cv.personal.fullName);
  if (cv.personal.title) lines.push(cv.personal.title);
  const contactBits: string[] = [];
  if (cv.personal.email) contactBits.push(cv.personal.email);
  if (cv.personal.phone) contactBits.push(cv.personal.phone);
  if (cv.personal.location) contactBits.push(cv.personal.location);
  if (cv.personal.linkedin) contactBits.push(cv.personal.linkedin);
  if (cv.personal.github) contactBits.push(cv.personal.github);
  if (cv.personal.portfolio) contactBits.push(cv.personal.portfolio);
  if (contactBits.length) lines.push(contactBits.join(" · "));
  lines.push("");

  // Summary
  if (cv.summary) {
    lines.push((isAr ? "النبذة" : "SUMMARY").toUpperCase());
    lines.push(cv.summary);
    lines.push("");
  }

  // Education
  if (cv.education.length > 0) {
    lines.push((isAr ? "التعليم" : "EDUCATION").toUpperCase());
    for (const e of cv.education) {
      const dateRange = [e.startDate, e.endDate].filter(Boolean).join(" – ");
      const headParts = [e.institution, e.location].filter(Boolean).join(", ");
      lines.push(`${headParts}${dateRange ? "  |  " + dateRange : ""}`);
      const subParts = [e.degree, e.gpa ? `GPA: ${e.gpa}` : ""].filter(Boolean).join(" · ");
      if (subParts) lines.push(subParts);
      if ((e.relevantCoursework ?? []).length > 0) {
        lines.push(`Relevant coursework: ${e.relevantCoursework!.join(", ")}`);
      }
      for (const h of e.honors ?? []) lines.push(`• ${h}`);
      lines.push("");
    }
  }

  // Experience
  if (cv.experience.length > 0) {
    lines.push((isAr ? "الخبرة" : "EXPERIENCE").toUpperCase());
    for (const x of cv.experience) {
      const dateRange = [x.startDate, x.endDate].filter(Boolean).join(" – ");
      lines.push(`${x.title} — ${x.organization}${x.location ? ", " + x.location : ""}${dateRange ? "  |  " + dateRange : ""}`);
      for (const b of x.bullets) lines.push(`• ${b}`);
      lines.push("");
    }
  }

  // Projects
  if (cv.projects.length > 0) {
    lines.push((isAr ? "المشاريع" : "PROJECTS").toUpperCase());
    for (const p of cv.projects) {
      const techPart = (p.techStack ?? []).length ? ` — ${p.techStack!.join(", ")}` : "";
      lines.push(`${p.name}${techPart}`);
      if (p.role) lines.push(p.role);
      for (const b of p.bullets) lines.push(`• ${b}`);
      if (p.url) lines.push(p.url);
      lines.push("");
    }
  }

  // Skills
  const sk = cv.skills;
  if ((sk.technical?.length || 0) + (sk.tools?.length || 0) + (sk.languages?.length || 0) + (sk.soft?.length || 0) > 0) {
    lines.push((isAr ? "المهارات" : "SKILLS").toUpperCase());
    if (sk.technical?.length) lines.push(`Technical: ${sk.technical.join(", ")}`);
    if (sk.tools?.length) lines.push(`Tools: ${sk.tools.join(", ")}`);
    if (sk.languages?.length) lines.push(`Languages: ${sk.languages.map((l) => `${l.name} (${l.level})`).join(", ")}`);
    if (sk.soft?.length) lines.push(`Soft skills: ${sk.soft.join(", ")}`);
    lines.push("");
  }

  // Activities
  if (cv.activities && cv.activities.length > 0) {
    lines.push((isAr ? "النشاطات" : "ACTIVITIES").toUpperCase());
    for (const a of cv.activities) {
      const dateRange = [a.startDate, a.endDate].filter(Boolean).join(" – ");
      lines.push(`${a.role} — ${a.organization}${dateRange ? "  |  " + dateRange : ""}`);
      for (const b of a.bullets ?? []) lines.push(`• ${b}`);
      lines.push("");
    }
  }

  // Certifications
  if (cv.certifications && cv.certifications.length > 0) {
    lines.push((isAr ? "الشهادات" : "CERTIFICATIONS").toUpperCase());
    for (const c of cv.certifications) {
      const bits = [c.name, c.issuer, c.date].filter(Boolean).join(" · ");
      lines.push(bits);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
