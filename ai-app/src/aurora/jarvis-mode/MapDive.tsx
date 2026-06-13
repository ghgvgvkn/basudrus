// ─────────────────────────────────────────────────────────────────
// MAP DIVE — the cinematic satellite dive, built from STATIC images.
//
// Why not the WebGL globe (MapGlobe)? On the founder's machine the
// live Mapbox GL globe rendered black every time, through two rounds
// of fixes — but static Mapbox satellite images render perfectly
// there (briefings, the small map tab). So this delivers the dive
// FEELING with the raster that actually works: 3 satellite frames at
// increasing zoom + tilt (Mapbox Static API supports pitch/bearing),
// crossfaded with a slow push so it reads as flying down from orbit
// to the ground. Zero WebGL → can never go black.
// ─────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

const TOKEN = (import.meta as { env?: Record<string, string | undefined> }).env
  ?.VITE_MAPBOX_TOKEN;

type Phase = "locating" | "ready" | "nosignal" | "error";

export default function MapDive({ place }: { place: string }) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [phase, setPhase] = useState<Phase>("locating");

  useEffect(() => {
    if (!TOKEN || !place) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    setPhase("locating");
    setFrames(null);

    (async () => {
      try {
        const geoUrl =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json` +
          `?access_token=${TOKEN}&limit=1`;
        const res = await fetch(geoUrl, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          features?: Array<{ center?: [number, number]; place_type?: string[] }>;
        };
        const f = data.features?.[0];
        if (!f?.center) {
          if (!cancelled) setPhase("nosignal");
          return;
        }
        const [lng, lat] = f.center;
        // Final zoom keyed to how SPECIFIC the place is, so we actually
        // land ON it (founder: "I should see the actual place inside").
        // A venue/address → street level; a city → neighbourhood; a
        // country → region. (Static API pitch maxes at 60.)
        const types = f.place_type || [];
        const has = (t: string) => types.includes(t);
        const target = has("address") || has("poi")
          ? 16.5
          : has("neighborhood") || has("locality") || has("district")
            ? 14.5
            : has("place")
              ? 12.5
              : has("region")
                ? 6.5
                : has("country")
                  ? 5
                  : 13;
        const start = Math.max(2.4, Math.min(3.5, target - 9));
        const mid = (start + target) / 2;

        // Static Images API supports pitch (0–60) + bearing, so each
        // frame is a tilted satellite shot at a tighter zoom — stacked
        // and crossfaded they read as a dive. 1000×640 @2x is crisp on
        // the big tab without blowing the request size.
        const mk = (zoom: number, pitch: number, bearing: number) =>
          `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
          `${lng},${lat},${zoom},${bearing},${pitch}/1000x640@2x?access_token=${TOKEN}`;
        const fr = [mk(start, 0, 0), mk(mid, 40, 14), mk(target, 60, 24)];

        // Preload so the crossfade never flashes a half-loaded frame.
        await Promise.all(
          fr.map(
            (u) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.src = u;
              }),
          ),
        );
        if (!cancelled) {
          setFrames(fr);
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [place]);

  return (
    <div className="jarvis-dive" onPointerDown={(e) => e.stopPropagation()}>
      {frames && (
        <>
          {frames.map((src, i) => (
            <img key={src} className={`jarvis-dive-frame f${i}`} src={src} alt="" draggable={false} />
          ))}
          {/* Pulsing ring on the centered target + place name. */}
          <div className="jarvis-dive-halo" aria-hidden />
          <div className="jarvis-dive-mark" aria-hidden />
          <div className="jarvis-dive-callout">
            <i aria-hidden />
            <span>{place}</span>
          </div>
        </>
      )}
      {(phase === "locating") && (
        <div className="jarvis-globe-status">DIVING TO {place.toUpperCase()}…</div>
      )}
      {phase === "nosignal" && <div className="jarvis-globe-status">NO MAP SIGNAL FOR {place.toUpperCase()}</div>}
      {phase === "error" && <div className="jarvis-globe-status">MAP UNAVAILABLE</div>}
    </div>
  );
}
