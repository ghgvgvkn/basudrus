/**
 * useGeoCity — pulls the user's best-guess city from /api/geo and
 * caches it locally so we don't hit the endpoint on every page load.
 *
 * The /api/geo edge function reads Vercel's automatic geolocation
 * headers (x-vercel-ip-city / -country), falling back to ipapi.co.
 * Result is cached in localStorage for 24h.
 *
 * Returns:
 *   { city, country, region, loading }
 *
 * Falls back gracefully — null `city` means we couldn't determine it,
 * UI should default to a sensible label ("AURORA", "BAS UDRUS", etc.).
 */
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiBase";

const CACHE_KEY = "bu:aurora:geo:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface GeoData {
  city: string | null;
  country: string | null;
  region: string | null;
}

interface CachedGeo extends GeoData {
  /** Epoch ms when this was stored. */
  cachedAt: number;
}

interface UseGeoCityResult extends GeoData {
  loading: boolean;
}

function readCache(): CachedGeo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGeo;
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: GeoData): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...data, cachedAt: Date.now() } satisfies CachedGeo),
    );
  } catch { /* localStorage unavailable — fine */ }
}

export function useGeoCity(): UseGeoCityResult {
  const [city, setCity] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Cache hit short-circuits the network call entirely.
    const cached = readCache();
    if (cached) {
      setCity(cached.city);
      setCountry(cached.country);
      setRegion(cached.region);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/geo"), { method: "GET" });
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const j = await res.json() as Partial<GeoData>;
        if (cancelled) return;
        const data: GeoData = {
          city: j.city ?? null,
          country: j.country ?? null,
          region: j.region ?? null,
        };
        setCity(data.city);
        setCountry(data.country);
        setRegion(data.region);
        writeCache(data);
      } catch {
        // Silent degrade — UI falls back to a hardcoded label.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { city, country, region, loading };
}
