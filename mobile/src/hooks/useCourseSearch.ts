/**
 * useCourseSearch — mobile twin of the web `useCourseSearch` hook.
 *
 * Queries the canonical `course_catalog` table — the deduplicated
 * single-row-per-course master list (~5,500 visible rows). Public-read
 * RLS lets unauthenticated callers use it, which matters because
 * Discover renders before sign-in in guest mode.
 *
 * Behavior:
 *   - Empty query → most-offered courses first (Math/CS gen-eds bubble
 *     to the top — what most students start typing).
 *   - Non-empty → ILIKE on name, popularity-then-name sorted.
 *   - 180ms debounce so we don't spam Supabase on every keystroke.
 *   - Excludes alias rows (`canonical_of IS NOT NULL`) so synonym
 *     entries don't show up as separate hits.
 *   - Graceful fallback to a tiny hard-coded list if the table is
 *     missing or the network is down, so the picker isn't blank.
 *
 * Web reference: src/features/discover/useCourseSearch.ts.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface Course {
  id: string;
  name: string;
}

/** Same 6 fallback rows as the web so demo / offline mode looks
 *  identical across clients. */
const FALLBACK_COURSES: Course[] = [
  { id: 'cs201',   name: 'CS 201 · Data Structures' },
  { id: 'cs301',   name: 'CS 301 · Databases' },
  { id: 'math201', name: 'MATH 201 · Linear Algebra' },
  { id: 'math301', name: 'MATH 301 · Calculus III' },
  { id: 'bio201',  name: 'BIO 201 · Molecular Biology' },
  { id: 'chem101', name: 'CHEM 101 · General Chemistry' },
];

export function useCourseSearch(query: string) {
  const [results, setResults] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        let req = supabase
          .from('course_catalog')
          .select('id, name')
          .is('canonical_of', null)
          .order('uni_courses_count', { ascending: false, nullsFirst: false })
          .order('name', { ascending: true })
          .limit(12);
        if (q) req = req.ilike('name', `%${q}%`);

        const { data, error } = await req;
        if (cancelled) return;
        if (error) throw error;

        setResults(
          ((data ?? []) as Array<{ id: string; name: string }>).map(c => ({
            id: c.id,
            name: c.name,
          })),
        );
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[useCourseSearch] supabase query failed, falling back:', err);
        const needle = q.toLowerCase();
        setResults(
          needle
            ? FALLBACK_COURSES.filter(c => c.name.toLowerCase().includes(needle))
            : FALLBACK_COURSES,
        );
        setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}
