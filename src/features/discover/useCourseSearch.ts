/**
 * useCourseSearch — debounced Supabase course search.
 *
 * Queries `uni_courses` (36,733 rows in prod) with ILIKE on the
 * `name` column. Returns the top 12 matches by display_order.
 * Debounces user input by 180ms so typing doesn't thrash the DB.
 *
 * If Supabase is unavailable (offline / misconfigured) we fall back
 * to a tiny hardcoded set so the UI still shows *something* — the
 * PostComposer and Rooms search both call this, and empty results
 * would make them feel broken.
 *
 * Read-only. No writes. No auth required (the `uni_courses` RLS
 * has a public SELECT policy — "Anyone can read courses").
 */
import { useEffect, useState } from "react";
import { supabase } from "@/shared/supabase";

export interface Course {
  id: string;
  name: string;
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

/** Search courses. Empty query → popular first 12 (by display_order).
 *  Non-empty → ILIKE on name, max 12 results, debounced 180ms. */
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
    const client = supabase; // narrow for TS — null was handled above
    const timer = setTimeout(async () => {
      try {
        // When query is empty, serve "popular" — sorted by
        // display_order (NULL last) then name, capped at 12.
        // When non-empty, use ILIKE for case-insensitive contains.
        let req = client
          .from("uni_courses")
          .select("id, name, major_id")
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .limit(12);
        if (q) req = req.ilike("name", `%${q}%`);
        const { data, error } = await req;
        if (cancelled) return;
        if (error) throw error;
        setResults((data as Course[]) ?? []);
        setLoading(false);
      } catch {
        if (cancelled) return;
        // Any error — auth, network, bad request — show fallback so
        // the UI doesn't appear broken. Real debugging happens in
        // the browser console / Supabase logs.
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
