/**
 * useUniversities + useMajors — mobile twins of the web onboarding
 * catalog hooks. Pulls from `public.universities` and `public.uni_majors`
 * so the mobile app sees the same ~600-row catalog the web app uses
 * instead of a hand-curated stub of 12 names.
 *
 * Web reference: /src/features/onboarding/useOnboardingCatalog.ts.
 *
 * Both hooks degrade gracefully: if the network or auth is unavailable
 * we fall back to a tiny seed list so the picker still works offline
 * and brand-new RLS sessions don't see an empty modal.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface University {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  display_order: number | null;
}

export interface Major {
  id: string;
  name: string;
  university_id: string | null;
}

// Sentinel UUID used by web for "Other / Not listed" — keep parity so
// rows seeded by either client interop. Mirrors web's FALLBACK_UNIS.
export const OTHER_UNI_ID = '00000000-0000-0000-0000-000000000099';

const FALLBACK_UNIS: University[] = [
  { id: 'fallback-psut',  name: 'Princess Sumaya University for Technology', city: 'Amman', country: 'Jordan', display_order: 1 },
  { id: 'fallback-juju',  name: 'University of Jordan',                       city: 'Amman', country: 'Jordan', display_order: 2 },
  { id: 'fallback-just',  name: 'Jordan University of Science and Technology',city: 'Irbid', country: 'Jordan', display_order: 3 },
  { id: 'fallback-gju',   name: 'German Jordanian University',                city: 'Amman', country: 'Jordan', display_order: 4 },
  { id: 'fallback-hu',    name: 'Hashemite University',                       city: 'Zarqa', country: 'Jordan', display_order: 5 },
  { id: 'fallback-aum',   name: 'American University of Madaba',              city: 'Madaba',country: 'Jordan', display_order: 6 },
  { id: OTHER_UNI_ID,     name: 'Other / Not listed',                         city: null,    country: null,     display_order: 99 },
];

const FALLBACK_MAJORS: Major[] = [
  { id: 'fb-cs',     name: 'Computer Science',           university_id: null },
  { id: 'fb-se',     name: 'Software Engineering',       university_id: null },
  { id: 'fb-ee',     name: 'Electrical Engineering',     university_id: null },
  { id: 'fb-me',     name: 'Mechanical Engineering',     university_id: null },
  { id: 'fb-bus',    name: 'Business Administration',    university_id: null },
  { id: 'fb-med',    name: 'Medicine',                   university_id: null },
  { id: 'fb-arch',   name: 'Architecture',               university_id: null },
  { id: 'fb-law',    name: 'Law',                        university_id: null },
];

export function useUniversities() {
  const [unis, setUnis] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('universities')
          .select('id, name, city, country, display_order')
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true })
          .limit(1000);
        if (cancelled) return;
        if (err || !data || data.length === 0) {
          setUnis(FALLBACK_UNIS);
          if (err) setError(err.message);
        } else {
          setUnis(data as University[]);
        }
      } catch (e) {
        if (!cancelled) {
          setUnis(FALLBACK_UNIS);
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { unis, loading, error };
}

/**
 * Pulls majors filtered by university when a uni id is provided; otherwise
 * the global catalog (across all unis). Falls back to a small hard-coded
 * list if the table is empty.
 */
export function useMajors(universityId?: string | null) {
  const [majors, setMajors] = useState<Major[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('uni_majors')
          .select('id, name, university_id')
          .order('name', { ascending: true })
          .limit(2000);
        if (universityId) query = query.eq('university_id', universityId);
        const { data, error: err } = await query;
        if (cancelled) return;
        if (err || !data || data.length === 0) {
          setMajors(FALLBACK_MAJORS);
        } else {
          // De-dupe by lowercase name — uni_majors may have multiple
          // rows for the same major across universities.
          const seen = new Set<string>();
          const dedup: Major[] = [];
          for (const row of data as Major[]) {
            const key = row.name.trim().toLowerCase();
            if (!seen.has(key)) { seen.add(key); dedup.push(row); }
          }
          setMajors(dedup);
        }
      } catch {
        if (!cancelled) setMajors(FALLBACK_MAJORS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [universityId]);

  return { majors, loading };
}

/** Pull all majors across all universities (deduped). For Discover filter. */
export function useAllMajors() {
  return useMajors(null);
}
