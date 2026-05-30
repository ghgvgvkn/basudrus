/**
 * usePastPapers — read + upload past_papers rows from Supabase.
 *
 * Web reference: /src/features/past-papers/usePastPapers.ts. Mobile-
 * specific bits:
 *   - File is a URI from expo-document-picker / expo-image-picker, not
 *     a browser File object. We pull bytes via fetch(uri).arrayBuffer()
 *     (same trick as uploadAvatar).
 *   - Storage path mirrors web RLS: `<userId>/<filename>-<timestamp>.<ext>`.
 *   - We always fetch ALL papers visible to the user (RLS already
 *     gates the response). The screen splits the list into "shared
 *     by everyone" + "your private locker".
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type ExamType = 'midterm' | 'final' | 'quiz' | 'practice' | 'other';
export type Semester  = 'fall' | 'spring' | 'summer';

export interface PastPaperRow {
  id: string;
  uni: string;
  course_code: string | null;
  course_name: string;
  professor_name: string | null;
  exam_type: ExamType | null;
  year: number | null;
  semester: Semester | null;
  file_url: string | null;
  topics_covered: string[];
  verified: boolean;
  shared: boolean;
  contributor_user_id: string | null;
  created_at: string;
}

export interface PaperAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface UploadPaperInput {
  uni: string;
  courseName: string;
  courseCode?: string | null;
  professorName?: string | null;
  examType: ExamType;
  year: number;
  semester: Semester;
  file: PaperAsset;
  /** Legal-consent ack — required, matches web §7.2 #2. */
  rightToShareAgreed: boolean;
  /** Private by default (§7.2 #3). */
  shareWithClassmates: boolean;
  topicsCovered?: string[];
}

export type UploadResult =
  | { ok: true; row: PastPaperRow }
  | { ok: false; error: string };

const MAX_PAPER_BYTES = 15 * 1024 * 1024; // 15 MB — generous for scanned PDFs

function safeFilename(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'paper'
  );
}

export function usePastPapers(uniFilter?: string, courseFilter?: string) {
  const [papers, setPapers] = useState<PastPaperRow[]>([]);
  const [myPapers, setMyPapers] = useState<PastPaperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData.session?.user?.id ?? null;

      // Pull shared papers for everyone; also pull this user's own
      // (regardless of share flag) so they show up under "My uploads".
      let query = supabase
        .from('past_papers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (uniFilter) query = query.ilike('uni', `%${uniFilter}%`);
      if (courseFilter) query = query.ilike('course_name', `%${courseFilter}%`);

      const { data, error: err } = await query;
      if (err) throw err;
      const rows = (data as PastPaperRow[]) ?? [];
      setPapers(rows.filter(r => r.shared));
      setMyPapers(myId ? rows.filter(r => r.contributor_user_id === myId) : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [uniFilter, courseFilter]);

  useEffect(() => { load(); }, [load]);

  const upload = useCallback(async (input: UploadPaperInput): Promise<UploadResult> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return { ok: false, error: 'Sign in to upload.' };
    if (!input.rightToShareAgreed) {
      return { ok: false, error: 'Please confirm you have the right to share this material.' };
    }
    if (!input.uni.trim()) return { ok: false, error: 'Pick your university first.' };
    if (!input.courseName.trim()) return { ok: false, error: 'Pick your course first.' };
    if (!input.file?.uri) return { ok: false, error: 'No file selected.' };

    if (typeof input.file.size === 'number' && input.file.size > MAX_PAPER_BYTES) {
      return { ok: false, error: 'File is over 15 MB. Try a smaller one.' };
    }

    // Pull bytes. fetch() handles file:// (iOS/Android picker URIs) and
    // content:// (Android scoped storage).
    let bytes: ArrayBuffer;
    let contentType = input.file.mimeType ?? 'application/pdf';
    try {
      const res = await fetch(input.file.uri);
      contentType = res.headers.get('content-type') ?? contentType;
      bytes = await res.arrayBuffer();
    } catch {
      return { ok: false, error: 'Could not read that file.' };
    }
    if (bytes.byteLength > MAX_PAPER_BYTES) {
      return { ok: false, error: 'File is over 15 MB. Try a smaller one.' };
    }

    const original = input.file.name || 'paper.pdf';
    const lastDot = original.lastIndexOf('.');
    const ext = lastDot > 0 ? original.slice(lastDot + 1).toLowerCase() : 'pdf';
    const base = lastDot > 0 ? original.slice(0, lastDot) : original;
    const filename = `${safeFilename(base)}-${Date.now()}.${ext}`;
    const path = `${userId}/${filename}`;

    const up = await supabase.storage
      .from('past-papers')
      .upload(path, bytes, { contentType, upsert: false });
    if (up.error) return { ok: false, error: `Upload failed: ${up.error.message}` };

    const { data: urlData } = supabase.storage.from('past-papers').getPublicUrl(path);
    const fileUrl = urlData.publicUrl;

    const { data: inserted, error: insErr } = await supabase
      .from('past_papers')
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
      // Cleanup orphan
      await supabase.storage.from('past-papers').remove([path]).catch(() => {});
      return { ok: false, error: insErr?.message ?? 'Could not save the paper.' };
    }

    const row = inserted as PastPaperRow;
    setMyPapers(prev => [row, ...prev]);
    if (row.shared) setPapers(prev => [row, ...prev]);
    return { ok: true, row };
  }, []);

  return { papers, myPapers, loading, error, refresh: load, upload };
}
