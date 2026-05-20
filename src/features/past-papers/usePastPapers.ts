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
          topics_covered: [],
          verified: false,
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

  const myRows = userId ? rows.filter((r) => r.contributor_user_id === userId) : [];

  return { rows, myRows, loading, error, refresh, upload, remove };
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
