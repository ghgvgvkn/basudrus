/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * usePastPapers — data hook for the Past Papers feature.
 *
 * Reads from public.past_papers (RLS: all authenticated users can SELECT,
 * contributor owns their own rows). Supports:
 *   - Listing by uni + course (Browse mode)
 *   - Listing your own contributions (My Papers tab)
 *   - Uploading a new paper to Storage + inserting the row
 *   - Deleting your own contribution (Storage object + row)
 *
 * Phase 1: no AI validation. The contributor confirms they have the
 * right to share via a checkbox before submit, the file goes to
 * Storage with a sanitized path, the row inserts directly. Phase 2
 * adds Claude-vision validation that the upload actually looks like
 * a past paper, plus auto-extraction of professor name + topics.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export type ExamType = "midterm" | "final" | "quiz" | "practice" | "other";
export type Semester = "fall" | "spring" | "summer";

export interface PastPaperRow {
  id: string;
  uni: string;
  course_code: string | null;
  course_name: string;
  professor_id: string | null;
  professor_name: string | null;
  exam_type: ExamType | null;
  year: number | null;
  semester: Semester | null;
  file_url: string | null;
  transcribed_text: string | null;
  topics_covered: string[];
  difficulty: string | null;
  verified: boolean;
  /** Private locker default. When false, only the contributor can
   *  see the row (RLS-enforced). The contributor flips this to true
   *  to share with the rest of their course's students. */
  shared: boolean;
  contributor_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadInput {
  uni: string;
  courseName: string;
  courseCode?: string | null;
  professorName?: string | null;
  examType: ExamType;
  year: number;
  semester: Semester;
  file: File;
  /** Per the locked-in legal rules (master strategy doc §7.2 #2):
   *  user MUST tick "I have the right to share this material" before
   *  upload completes. The component enforces it; we double-check
   *  here so a bypassed UI can't ship a row without consent. */
  rightToShareAgreed: boolean;
  /** Strategy doc §7.2 #3: PRIVATE by default. The contributor
   *  decides to share with classmates by ticking this. Independent
   *  of the legal-agreement above — agreement = "I have the legal
   *  right", share = "I want others to see it". Default: false. */
  shareWithClassmates: boolean;
  /** Topics extracted by the AI analyzer (optional). When the user
   *  ran "Analyze with AI" before submitting, we carry the topics
   *  through to the row + the professors-cache upsert below. */
  topicsCovered?: string[];
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  fileUrl?: string;
  error?: string;
}

/** Slugify untrusted user input for safe Storage paths. Allows alnum,
 *  dash, underscore, dot; collapses runs of "_" so we don't end up
 *  with `___midterm___.pdf`. */
function safeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "paper";
}

export interface UsePastPapersResult {
  /** All past papers visible to the user (RLS handles filtering). */
  rows: PastPaperRow[];
  /** Just the rows this user contributed. */
  myRows: PastPaperRow[];
  /** True while the initial query is in flight. */
  loading: boolean;
  /** Last load/upload error, null when none. */
  error: string | null;
  /** Re-fetch from the server. */
  refresh: () => Promise<void>;
  /** Upload a new past paper. Returns the inserted row's id on success. */
  upload: (input: UploadInput) => Promise<UploadResult>;
  /** Delete a contribution this user owns. */
  remove: (id: string) => Promise<boolean>;
  /** Flip the share toggle on a contribution this user owns. When
   *  turning ON for the first time, also seeds the professors cache. */
  setShared: (id: string, shared: boolean) => Promise<boolean>;
}

export function usePastPapers(): UsePastPapersResult {
  const { user } = useSupabaseSession();
  const userId = user?.id ?? null;

  const [rows, setRows] = useState<PastPaperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("past_papers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) {
        setError(err.message);
        setRows([]);
      } else {
        setRows((data as PastPaperRow[]) ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load past papers");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback<UsePastPapersResult["upload"]>(async (input) => {
    if (!userId) return { ok: false, error: "You need to sign in to upload." };
    if (!input.rightToShareAgreed) {
      return { ok: false, error: "Please confirm you have the right to share this material." };
    }
    if (!input.file) return { ok: false, error: "No file selected." };
    if (!input.uni.trim()) return { ok: false, error: "Pick your university first." };
    if (!input.courseName.trim()) return { ok: false, error: "Pick your course first." };

    // Storage path = <auth.uid>/<safe filename>-<timestamp>.<ext>
    // RLS requires the first folder segment to equal the user's ID
    // (see migration `create_past_papers_storage_bucket`).
    const original = input.file.name;
    const lastDot = original.lastIndexOf(".");
    const ext = lastDot > 0 ? original.slice(lastDot + 1).toLowerCase() : "";
    const base = lastDot > 0 ? original.slice(0, lastDot) : original;
    const filename = `${safeFilename(base)}-${Date.now()}${ext ? `.${ext}` : ""}`;
    const path = `${userId}/${filename}`;

    try {
      const up = await supabase.storage
        .from("past-papers")
        .upload(path, input.file, {
          contentType: input.file.type || "application/octet-stream",
          upsert: false,
        });
      if (up.error) {
        return { ok: false, error: `Upload failed: ${up.error.message}` };
      }

      const { data: urlData } = supabase.storage.from("past-papers").getPublicUrl(path);
      const fileUrl = urlData.publicUrl;

      const { data: inserted, error: insErr } = await supabase
        .from("past_papers")
        .insert({
          uni: input.uni.trim(),
          course_code: input.courseCode?.trim() || null,
          course_name: input.courseName.trim(),
          professor_name: input.professorName?.trim() || null,
          exam_type: input.examType,
          year: input.year,
          semester: input.semester,
          file_url: fileUrl,
          topics_covered: input.topicsCovered ?? [],
          verified: false,
          shared: input.shareWithClassmates,
          contributor_user_id: userId,
        })
        .select()
        .single();

      if (insErr || !inserted) {
        // Best-effort cleanup so a failed insert doesn't leave an
        // orphaned file in Storage.
        await supabase.storage.from("past-papers").remove([path]).catch(() => {});
        return { ok: false, error: `Couldn't save the paper: ${insErr?.message ?? "unknown error"}` };
      }

      // ── Universal Data Layer wiring ──
      // If a professor name is on the row (AI-extracted OR manually
      // typed) AND the user opted to share, upsert into
      // public.professors so Tony Starrk's DATABASE CONTEXT block on
      // the tutor side picks up real prof metadata across all students.
      // Private uploads are NOT folded into the cache — the rule from
      // §7.1: only objectively shareable facts enter the universal
      // layer; if the contributor wanted privacy, we honor it here too.
      if (input.shareWithClassmates && input.professorName?.trim()) {
        await upsertProfessorContribution({
          uni: input.uni.trim(),
          name: input.professorName.trim(),
          courseName: input.courseName.trim(),
          courseCode: input.courseCode?.trim() || null,
          topics: input.topicsCovered ?? [],
          fileUrl,
          userId,
        }).catch(() => { /* swallow — past_papers insert already succeeded */ });
      }

      // ── University auto-add (Phase 2d) ──
      // Fire-and-forget: ask the server to verify this uni name
      // (Tavily + Claude Haiku) and INSERT it into public.universities
      // for the next student. The past_papers row already saved
      // with whatever the user typed, so this is purely additive —
      // it builds the canonical catalog without ever blocking an
      // upload. The endpoint is idempotent (catalog hit → returns
      // "match", skips the AI call) and rate-limited at 30/day per
      // user, so spamming it is harmless.
      //
      // We deliberately do NOT await this and do NOT surface errors
      // — the user's contribution is already saved; whether the
      // canonical catalog grows is a background concern.
      void verifyAndCatalogUniversity(input.uni.trim()).catch(() => {});

      // Optimistically prepend the new row instead of a full re-fetch.
      setRows((prev) => [inserted as PastPaperRow, ...prev]);
      return { ok: true, id: (inserted as PastPaperRow).id, fileUrl };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Upload failed" };
    }
  }, [userId]);

  const remove = useCallback<UsePastPapersResult["remove"]>(async (id) => {
    if (!userId) return false;
    // Find the row first so we can also remove the Storage object.
    const row = rows.find((r) => r.id === id);
    const { error: delErr } = await supabase
      .from("past_papers")
      .delete()
      .eq("id", id)
      .eq("contributor_user_id", userId);
    if (delErr) {
      setError(delErr.message);
      return false;
    }
    // Best-effort Storage cleanup. The file_url shape is:
    //   https://<project>.supabase.co/storage/v1/object/public/past-papers/<uid>/<filename>
    if (row?.file_url) {
      try {
        const marker = "/object/public/past-papers/";
        const idx = row.file_url.indexOf(marker);
        if (idx >= 0) {
          const path = row.file_url.slice(idx + marker.length).split("?")[0];
          await supabase.storage.from("past-papers").remove([path]);
        }
      } catch { /* swallow — DB row is gone, that's the source of truth */ }
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    return true;
  }, [rows, userId]);

  const setShared = useCallback<UsePastPapersResult["setShared"]>(async (id, shared) => {
    if (!userId) return false;
    const row = rows.find((r) => r.id === id);
    const wasShared = row?.shared ?? false;

    const { error: updErr } = await supabase
      .from("past_papers")
      .update({ shared, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("contributor_user_id", userId);
    if (updErr) {
      setError(updErr.message);
      return false;
    }

    setRows((prev) => prev.map((r) => r.id === id ? { ...r, shared } : r));

    // First time turning sharing ON for a row that has a professor
    // name → seed the universal data layer. Going from on→off does
    // NOT pull the row back out of the professors cache (other
    // students may already rely on it; un-sharing your file from the
    // library is your right, but we don't retroactively scrub the
    // pattern signal it contributed).
    if (shared && !wasShared && row && row.professor_name && row.file_url) {
      upsertProfessorContribution({
        uni: row.uni,
        name: row.professor_name,
        courseName: row.course_name,
        courseCode: row.course_code,
        topics: row.topics_covered || [],
        fileUrl: row.file_url,
        userId,
      }).catch(() => { /* swallow — best-effort */ });
    }
    return true;
  }, [userId, rows]);

  const myRows = userId ? rows.filter((r) => r.contributor_user_id === userId) : [];

  return { rows, myRows, loading, error, refresh, upload, remove, setShared };
}

// ── Professor cache wiring ─────────────────────────────────────────

/**
 * Upsert a professor contribution into public.professors so the
 * Universal Data Layer Tony Starrk reads from gets seeded by real
 * student uploads. Identity = (uni, lower(name)) — same row gets
 * its courses_taught / common_topics / past_paper_links arrays
 * merged across multiple contributions.
 *
 * RLS allows authenticated users to INSERT (with their own
 * contributor_user_id) and UPDATE any unverified row, so additive
 * merges from later students work. Verified rows are admin-only.
 *
 * Errors are swallowed by the caller — the past_papers insert
 * already succeeded, so the professor side-effect is best-effort.
 */
async function upsertProfessorContribution({
  uni, name, courseName, courseCode, topics, fileUrl, userId,
}: {
  uni: string;
  name: string;
  courseName: string;
  courseCode: string | null;
  topics: string[];
  fileUrl: string;
  userId: string;
}): Promise<void> {
  // Strip "Dr." / "Prof." prefixes so identity comparison is stable.
  const cleanName = name.replace(/^\s*(?:dr|prof|professor|د|أ)\.?\s*/i, "").trim();
  if (!cleanName) return;

  // Look up existing row by (uni, lower(name)). The unique index
  // backs this lookup.
  const { data: existing } = await supabase
    .from("professors")
    .select("id, courses_taught, common_topics, past_paper_links, contribution_count")
    .eq("uni", uni)
    .ilike("name", cleanName)
    .maybeSingle();

  // Combine the course's display label — "CS340 · Operating Systems"
  // when we have both, otherwise just course name.
  const courseLabel = courseCode ? `${courseCode} · ${courseName}` : courseName;

  if (existing) {
    // Merge into existing arrays — dedupe by lowercased value.
    const existCourses: string[] = Array.isArray(existing.courses_taught) ? existing.courses_taught as string[] : [];
    const existTopics:  string[] = Array.isArray(existing.common_topics)  ? existing.common_topics  as string[] : [];
    const existLinks:   string[] = Array.isArray(existing.past_paper_links) ? existing.past_paper_links as string[] : [];
    const lowerSet = (arr: string[]) => new Set(arr.map((s) => s.toLowerCase()));
    const courseSet = lowerSet(existCourses);
    const topicSet  = lowerSet(existTopics);
    const linkSet   = new Set(existLinks);
    const mergedCourses = courseSet.has(courseLabel.toLowerCase()) ? existCourses : [...existCourses, courseLabel].slice(0, 20);
    const mergedTopics  = [...existTopics, ...topics.filter((t) => !topicSet.has(t.toLowerCase()))].slice(0, 30);
    const mergedLinks   = linkSet.has(fileUrl) ? existLinks : [...existLinks, fileUrl].slice(0, 50);

    await supabase
      .from("professors")
      .update({
        courses_taught: mergedCourses,
        common_topics: mergedTopics,
        past_paper_links: mergedLinks,
        contribution_count: ((existing.contribution_count as number) ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
  } else {
    await supabase.from("professors").insert({
      uni,
      name: cleanName,
      courses_taught: [courseLabel],
      common_topics: topics.slice(0, 30),
      past_paper_links: [fileUrl],
      student_tips: [],
      verified: false,
      contribution_count: 1,
      contributor_user_id: userId,
    });
  }
}

// ── University auto-add (Phase 2d) ─────────────────────────────────

/**
 * Background call to /api/past-papers/validate-university so a uni
 * name typed by a student gets verified (Tavily + Claude Haiku) and
 * INSERTed into the canonical public.universities table for future
 * students. See validate-university.ts for the verdict routing —
 * the only thing this client cares about is "fire the call." We
 * don't care about the response; the past_papers row already saved.
 *
 * Errors are swallowed by the caller — the upload already succeeded
 * and the canonical catalog growing in the background is best-effort.
 *
 * Auth header is required by the server-side rate limiter; without
 * a session token the call would 401 silently which is the right
 * outcome (anonymous uploads shouldn't exist in the first place
 * because the upload path itself requires a userId).
 */
async function verifyAndCatalogUniversity(name: string): Promise<void> {
  if (!name || name.length < 3) return;
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  // No await on the fetch's body — we don't need the verdict.
  await fetch("/api/past-papers/validate-university", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
    // keepalive lets the call survive a page navigation if the user
    // bounces to My Papers right after upload (we setTimeout 900ms
    // in PastPapersScreen.tsx → onUploaded). 8 KB request body is
    // well under the keepalive limit.
    keepalive: true,
  });
}

// ── AI analyzer client ─────────────────────────────────────────────

export interface AnalyzeOutput {
  ok: boolean;
  isPastPaper: boolean;
  confidence: number;
  extracted: {
    courseName?: string;
    courseCode?: string;
    professorName?: string;
    year?: number;
    semester?: Semester;
    examType?: ExamType;
    topicsCovered: string[];
    difficulty?: "easy" | "medium" | "hard";
  };
  reasoning: string;
  error?: string;
}

/** Read a File into base64 + mime metadata. Handles both images
 *  (passed as `image` content blocks) and PDFs (passed as
 *  `document` content blocks) — matches the existing tutor.ts API
 *  contract so we share the same Anthropic payload shape. */
async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string; kind: "image" | "pdf" | "other" }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked base64 to avoid argument-length blowups on iOS Safari.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  const base64 = btoa(bin);
  const t = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (t === "application/pdf" || name.endsWith(".pdf")) return { base64, mediaType: "application/pdf", kind: "pdf" };
  if (t.startsWith("image/")) {
    // Sonnet vision accepts jpeg/png/webp/gif. Map heic to "image/jpeg"
    // by best effort — most browsers will refuse heic outright before
    // we get here, but the type might lie.
    const safe = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(t) ? t : "image/jpeg";
    return { base64, mediaType: safe, kind: "image" };
  }
  return { base64, mediaType: t || "application/octet-stream", kind: "other" };
}

/** Call the server-side AI analyzer with the user's file. */
export async function analyzePastPaper({
  file, hint,
}: {
  file: File;
  hint?: string;
}): Promise<AnalyzeOutput> {
  const empty: AnalyzeOutput = {
    ok: false,
    isPastPaper: false,
    confidence: 0,
    extracted: { topicsCovered: [] },
    reasoning: "Analysis not run.",
  };
  if (!file) return { ...empty, error: "No file" };

  // Get the current session token — required by the rate limiter.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ...empty, error: "Sign in to analyze uploads." };

  const encoded = await fileToBase64(file);
  if (encoded.kind === "other") {
    return { ...empty, error: "Only PDF or image files can be analyzed." };
  }

  const body: Record<string, unknown> = { hint };
  if (encoded.kind === "pdf") {
    body.pdfBase64 = encoded.base64;
    body.pdfName = file.name;
  } else {
    body.imageBase64 = encoded.base64;
    body.imageMediaType = encoded.mediaType;
  }

  try {
    const res = await fetch("/api/past-papers/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { ...empty, error: `Analysis failed (${res.status})` };
    }
    return json as AnalyzeOutput;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Network error" };
  }
}
