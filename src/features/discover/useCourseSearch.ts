/**
 * useCourseSearch — debounced search over the canonical course catalog.
 *
 * Queries `course_catalog` — the deduplicated, single-row-per-course
 * master list. Today that's ~5,492 visible rows (all Jordanian
 * courses, deduplicated across four cleanup passes). Future
 * migrations grow this toward ~20,000 worldwide canonical courses
 * without changing this hook.
 *
 * History note: an earlier `uni_courses` table held 36,733
 * per-major-per-uni rows with massive duplication. It was collapsed
 * down to 5,492 unique rows in the 2026-05-13 cleanup, then dropped
 * entirely once nothing else read from it. The frozen backup
 * `_backup_uni_courses_20260513` still has the original 36,733
 * rows if anyone needs the per-major mapping back.
 *
 * Sort:
 *   - When the query is empty, return the most-offered courses first
 *     (Math/CS general-ed courses bubble up — what most students start
 *     typing). Driven by `uni_courses_count` (legacy name, kept for
 *     popularity counter — it's just the merged dedup count now).
 *   - When the query is non-empty, also sort by frequency so the more
 *     common matches appear first. Tie-break alphabetically.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/shared/supabase";

export interface Course {
  id: string;
  name: string;
  /** Legacy: kept on the type so older consumers don't need to be
   *  refactored. Always null — canonical courses aren't tied to a
   *  specific major. The platform connects students BY COURSE, so a
   *  per-major link isn't needed. */
  major_id: string | null;
}

const FALLBACK_COURSES: Course[] = [
  { id: "cs201", name: "CS 201 · Data Structures",   major_id: null },
  { id: "cs301", name: "CS 301 · Databases",          major_id: null },
  { id: "math201", name: "MATH 201 · Linear Algebra", major_id: null },
  { id: "math301", name: "MATH 301 · Calculus III",   major_id: null },
  { id: "bio201", name: "BIO 201 · Molecular Biology", major_id: null },
  { id: "chem101", name: "CHEM 101 · General Chemistry", major_id: null },
];

/** Search courses. Empty query → most-offered first, 12 results.
 *  Non-empty → ILIKE on name, sorted by popularity, max 12 results,
 *  debounced 180ms. */
export function useCourseSearch(query: string) {
  const [results, setResults] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();

    // Demo mode — no Supabase — filter the fallback locally.
    if (!supabase) {
      const needle = q.toLowerCase();
      const matches = needle
        ? FALLBACK_COURSES.filter(c => c.name.toLowerCase().includes(needle))
        : FALLBACK_COURSES;
      setResults(matches);
      return;
    }

    setLoading(true);
    const client = supabase; // narrow for TS
    const timer = setTimeout(async () => {
      try {
        // Query the canonical catalog. Excludes alias rows
        // (canonical_of IS NOT NULL) so synonym entries don't show up
        // as separate hits — only their canonical form.
        let req = client
          .from("course_catalog")
          .select("id, name")
          .is("canonical_of", null)
          .order("uni_courses_count", { ascending: false, nullsFirst: false })
          .order("name", { ascending: true })
          .limit(12);
        if (q) req = req.ilike("name", `%${q}%`);
        const { data, error } = await req;
        if (cancelled) return;
        if (error) throw error;
        // course_catalog doesn't carry a major_id — back-populate null
        // so the legacy Course shape callers expect stays compatible.
        setResults(((data ?? []) as Array<{ id: string; name: string }>).map(c => ({
          id: c.id, name: c.name, major_id: null,
        })));
        setLoading(false);
      } catch {
        if (cancelled) return;
        // Any error — auth, network, table missing on an older deploy —
        // show fallback so the UI doesn't appear broken. Real debugging
        // happens in browser console / Supabase logs.
        const needle = q.toLowerCase();
        setResults(needle
          ? FALLBACK_COURSES.filter(c => c.name.toLowerCase().includes(needle))
          : FALLBACK_COURSES);
        setLoading(false);
      }
    }, 180);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return { results, loading };
}
