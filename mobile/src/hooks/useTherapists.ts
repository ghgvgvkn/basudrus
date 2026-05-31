/**
 * useTherapists — mobile twin of the web verified-therapist directory.
 *
 * Pulls from `public.mh_therapists`. Only rows with `active = true`
 * AND `verified_at IS NOT NULL` are returned — the website is strict
 * about this and we mirror it. If the table is empty (RLS, fresh
 * session, network blip) the caller renders an honest "no verified
 * provider yet" message rather than a fabricated list.
 *
 * Web reference: /src/features/ai/useTherapists.ts.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type TherapistKind =
  | 'therapist'
  | 'psychologist'
  | 'psychiatrist'
  | 'counseling_org'
  | 'hotline'
  | 'hospital'
  | 'online_therapy';

export interface Therapist {
  id: string;
  name: string;
  kind: TherapistKind;
  description: string;
  specialties: string[];
  languages: string[];
  /** Tier tags — 'mild' | 'moderate' | 'severe' | 'crisis'. */
  severities: string[];
  city: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  isFree: boolean;
  isSlidingScale: boolean;
}

interface RawRow {
  id: string;
  name: string;
  kind: TherapistKind;
  description: string;
  specialties: string[] | null;
  languages: string[] | null;
  severities: string[] | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  is_free: boolean | null;
  is_sliding_scale: boolean | null;
}

export function useTherapists() {
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('mh_therapists')
          .select('id,name,kind,description,specialties,languages,severities,city,address,phone,url,is_free,is_sliding_scale')
          .eq('active', true)
          .not('verified_at', 'is', null)
          .order('name');
        if (cancelled) return;
        if (error || !data) {
          setTherapists([]);
        } else {
          setTherapists((data as RawRow[]).map(r => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            description: r.description,
            specialties: r.specialties ?? [],
            languages: r.languages ?? [],
            severities: r.severities ?? [],
            city: r.city,
            address: r.address,
            phone: r.phone,
            url: r.url,
            isFree: !!r.is_free,
            isSlidingScale: !!r.is_sliding_scale,
          })));
        }
      } catch {
        if (!cancelled) setTherapists([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    therapists,
    loading,
    /** Returns the subset of therapists tagged for a given severity tier. */
    forSeverity: (severity: string) =>
      therapists.filter(t => t.severities.includes(severity)),
  };
}
