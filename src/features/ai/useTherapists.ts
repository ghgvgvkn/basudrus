/**
 * useTherapists — load the verified Jordan therapist directory.
 *
 * Honesty: only rows with verified_at set + active = true are returned.
 * If no rows match a given severity, the caller should show an honest
 * "I don't have a verified provider for that yet" message — never
 * fabricate a therapist.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface Therapist {
  id: string;
  name: string;
  kind: "therapist" | "psychologist" | "psychiatrist" | "counseling_org" | "hotline" | "hospital" | "online_therapy";
  description: string;
  specialties: string[];
  languages: string[];
  severities: string[]; // e.g. ['mild','moderate','severe','crisis']
  city: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  isFree: boolean;
  isSlidingScale: boolean;
}

interface UseTherapistsReturn {
  therapists: Therapist[];
  loading: boolean;
  /** Filter helper — returns the subset matching a severity tier. */
  forSeverity: (severity: string) => Therapist[];
}

interface RawRow {
  id: string;
  name: string;
  kind: Therapist["kind"];
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

export function useTherapists(): UseTherapistsReturn {
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase) {
        setTherapists([]);
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("mh_therapists")
          .select("id,name,kind,description,specialties,languages,severities,city,address,phone,url,is_free,is_sliding_scale")
          .eq("active", true)
          .not("verified_at", "is", null)
          .order("name");
        if (cancelled) return;
        if (error) {
          if (import.meta.env.DEV) console.warn("[useTherapists] load:", error);
          setTherapists([]);
          return;
        }
        const rows = (data as RawRow[] | null) ?? [];
        setTherapists(rows.map((r) => ({
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
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[useTherapists] load threw:", e);
        if (!cancelled) setTherapists([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const forSeverity = (severity: string): Therapist[] => {
    return therapists.filter((t) => t.severities.includes(severity));
  };

  return { therapists, loading, forSeverity };
}
