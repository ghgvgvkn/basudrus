/**
 * useOnboardingCatalog — reads universities + majors from Supabase.
 *
 * Connects to the same `universities` / `uni_majors` tables that the
 * live production site uses. Queries are read-only; no writes happen
 * from the preview. If env vars are missing or the fetch fails, the
 * hook returns a hardcoded fallback so the onboarding form still
 * works offline and in demo mode.
 *
 * University → Major is a 1-to-many relationship via `university_id`.
 * We lazy-load majors once a university is chosen to avoid pulling
 * all 505 majors up front.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/shared/supabase";

export interface University {
  id: string;
  name: string;
  short_name: string | null;
}

export interface Major {
  id: string;
  university_id: string;
  name: string;
}

/** Hardcoded fallback when Supabase isn't reachable (demo mode or
 *  network failure). Keeps the onboarding form functional offline. */
const FALLBACK_UNIS: University[] = [
  { id: "fallback-psut", name: "Princess Sumaya University for Technology", short_name: "PSUT" },
  { id: "fallback-ju",   name: "University of Jordan", short_name: "JU" },
  { id: "fallback-ju-s", name: "Jordan University of Science and Technology", short_name: "JUST" },
  { id: "fallback-yu",   name: "Yarmouk University", short_name: "YU" },
  { id: "fallback-aabu", name: "Al al-Bayt University", short_name: "AABU" },
  { id: "fallback-mu",   name: "Mutah University", short_name: "MU" },
];
const FALLBACK_MAJORS_BY_UNI: Record<string, string[]> = {
  default: [
    "Computer Science", "Computer Engineering", "Software Engineering",
    "Electrical Engineering", "Mechanical Engineering", "Civil Engineering",
    "Medicine", "Dentistry", "Pharmacy", "Nursing",
    "Mathematics", "Physics", "Chemistry", "Biology",
    "Business Administration", "Accounting", "Finance", "Marketing",
    "Arabic Literature", "English Literature", "History", "Psychology",
    "Law", "Architecture",
  ],
};

export function useUniversities() {
  const [data, setData] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        // Demo mode — render fallback after a frame so UI doesn't flash.
        if (!cancelled) { setData(FALLBACK_UNIS); setLoading(false); }
        return;
      }
      try {
        const { data: rows, error: err } = await supabase
          .from("universities")
          .select("id, name, short_name")
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name");
        if (cancelled) return;
        if (err) throw err;
        setData(rows && rows.length ? (rows as University[]) : FALLBACK_UNIS);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setData(FALLBACK_UNIS);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

export function useMajors(universityId: string | null) {
  const [data, setData] = useState<Major[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!universityId) { setData([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // If this is a fallback uni id (user picked from the offline
      // list), serve a generic major list rather than 0 results.
      const isFallback = universityId.startsWith("fallback-");
      if (!supabase || isFallback) {
        if (!cancelled) {
          setData((FALLBACK_MAJORS_BY_UNI[universityId] ?? FALLBACK_MAJORS_BY_UNI.default).map((name, i) => ({
            id: `${universityId}:${i}`, university_id: universityId, name,
          })));
          setLoading(false);
        }
        return;
      }
      try {
        const { data: rows, error } = await supabase
          .from("uni_majors")
          .select("id, university_id, name")
          .eq("university_id", universityId)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name");
        if (cancelled) return;
        if (error) throw error;
        setData(rows && rows.length ? (rows as Major[]) : FALLBACK_MAJORS_BY_UNI.default.map((name, i) => ({
          id: `${universityId}:${i}`, university_id: universityId, name,
        })));
        setLoading(false);
      } catch {
        if (cancelled) return;
        setData(FALLBACK_MAJORS_BY_UNI.default.map((name, i) => ({
          id: `${universityId}:${i}`, university_id: universityId, name,
        })));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [universityId]);

  return { data, loading };
}
