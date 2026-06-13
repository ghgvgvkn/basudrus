// ─────────────────────────────────────────────────────────────────
// MAP GLOBE — the real Google-Earth-style 3D dive (founder's video).
//
// A live Mapbox GL globe that opens looking at Earth from orbit, then
// flies DOWN to the requested place with tilt + perspective — the
// continuous cinematic dive, not a two-frame crossfade.
//
// PERFORMANCE CONTRACT (the founder's MacBook is weak and WebGL is the
// one thing that has hurt it):
//   - This component is mounted ONLY when a map tab is OPENED BIG
//     (expanded). The small/collapsed map tab keeps the cheap static
//     image. So at most one WebGL globe ever exists, during a focused
//     moment the user chose.
//   - mapbox-gl is dynamically imported here, so the ~1.5MB library is
//     code-split out of the main bundle and only fetched the first
//     time a globe is actually opened.
//   - map.remove() runs on unmount → the WebGL context and all tiles
//     are freed the instant the tab closes or shrinks.
//   - antialias off, no globe auto-spin loop — the flyTo is the only
//     animation, and it ends.
// ─────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

const TOKEN = (import.meta as { env?: Record<string, string | undefined> }).env
  ?.VITE_MAPBOX_TOKEN;

type Phase = "locating" | "diving" | "landed" | "nosignal" | "error";

export default function MapGlobe({ place }: { place: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("locating");

  useEffect(() => {
    if (!TOKEN || !place || !containerRef.current) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      // 1. Geocode the place → coordinates + how wide a view it needs.
      let lng: number;
      let lat: number;
      let isWide = false;
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json` +
          `?access_token=${TOKEN}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          features?: Array<{ center?: [number, number]; place_type?: string[] }>;
        };
        const f = data.features?.[0];
        if (!f?.center) {
          if (!cancelled) setPhase("nosignal");
          return;
        }
        [lng, lat] = f.center;
        const wideTypes = new Set(["country", "region", "place"]);
        isWide = !!f.place_type?.some((t) => wideTypes.has(t));
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled || !containerRef.current) return;

      // 2. Pull in the heavy WebGL lib only now (code-split + on-demand).
      let mapboxgl: typeof import("mapbox-gl").default;
      try {
        mapboxgl = (await import("mapbox-gl")).default;
        await import("mapbox-gl/dist/mapbox-gl.css");
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled || !containerRef.current) return;

      // WebGL guard: if the GPU/browser can't run Mapbox GL, say so
      // LOUDLY instead of painting a silent black panel (founder: "it
      // was nothing, literally — a black screen").
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sup = (mapboxgl as any).supported;
      if (typeof sup === "function" && !sup()) {
        if (!cancelled) setPhase("error");
        return;
      }

      // The tab spawns EXPANDED, so the container may still be mid-
      // layout (0 height) the instant we mount — Mapbox reads that size
      // once and renders black forever. Wait for a real height first.
      for (let tries = 0; tries < 20 && containerRef.current.clientHeight < 40; tries++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (cancelled || !containerRef.current) return;
      }

      mapboxgl.accessToken = TOKEN!;
      try {
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/satellite-streets-v12",
          center: [lng, lat],
          zoom: 1.35, // from space — the whole globe
          pitch: 0,
          bearing: 0,
          projection: { name: "globe" },
          antialias: false,
          attributionControl: false,
          interactive: true,
          maxPitch: 75,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      } catch {
        if (!cancelled) setPhase("error"); // WebGL context creation failed
        return;
      }

      map.on("style.load", () => {
        // Atmosphere halo — the blue rim of Earth from orbit.
        try {
          map.setFog({
            color: "rgb(186, 220, 255)",
            "high-color": "rgb(36, 92, 180)",
            "horizon-blend": 0.18,
            "space-color": "rgb(2, 6, 14)",
            "star-intensity": 0.5,
          });
        } catch {
          /* older style — fog optional */
        }
      });

      map.on("error", () => {
        if (!cancelled) setPhase("error");
      });

      // Re-fit when the expanded tab is resized by hand (two-hand
      // scale). Without an explicit resize() the GL canvas stretches.
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        ro = new ResizeObserver(() => {
          try { map.resize(); } catch { /* torn down */ }
        });
        ro.observe(containerRef.current);
      }

      map.on("load", () => {
        if (cancelled) return;
        setPhase("diving");
        // RESIZE KICKS — the cure for the black globe. Force Mapbox to
        // re-measure the (now fully laid-out) container at load and a
        // couple beats after, so it can't stay stuck on a stale 0-size.
        const kick = () => { try { map.resize(); } catch { /* gone */ } };
        kick();
        window.setTimeout(kick, 120);
        window.setTimeout(kick, 400);
        // Amber pin at the target.
        try {
          new mapboxgl.Marker({ color: "#ffcf40" }).setLngLat([lng, lat]).addTo(map);
        } catch {
          /* marker optional */
        }
        // THE DIVE: hold at orbit for a beat, then fly down with tilt.
        const cityZoom = isWide ? 8.5 : 16;
        window.setTimeout(() => {
          if (cancelled || !map) return;
          map.flyTo({
            center: [lng, lat],
            zoom: cityZoom,
            pitch: 62, // tilt → 3D perspective, like the video
            bearing: -18,
            duration: 6000,
            curve: 1.6, // the Google-Earth arc (out then down)
            essential: true,
          });
          map.once("moveend", () => {
            if (!cancelled) setPhase("landed");
          });
        }, 850);
      });
    })();

    return () => {
      cancelled = true;
      if (ro) {
        try { ro.disconnect(); } catch { /* noop */ }
        ro = null;
      }
      if (map) {
        try {
          map.remove(); // free the WebGL context + tiles immediately
        } catch {
          /* already torn down */
        }
        map = null;
      }
    };
  }, [place]);

  return (
    <div className="jarvis-globe">
      <div ref={containerRef} className="jarvis-globe-canvas" onPointerDown={(e) => e.stopPropagation()} />
      {(phase === "locating" || phase === "diving") && (
        <div className="jarvis-globe-status">
          {phase === "locating" ? `LOCATING ${place.toUpperCase()}…` : `DIVING TO ${place.toUpperCase()}…`}
        </div>
      )}
      {phase === "nosignal" && <div className="jarvis-globe-status">NO MAP SIGNAL FOR {place.toUpperCase()}</div>}
      {phase === "error" && <div className="jarvis-globe-status">MAP UNAVAILABLE</div>}
      {phase !== "error" && phase !== "nosignal" && (
        <div className="jarvis-globe-callout">
          <i aria-hidden />
          <span>{place}</span>
        </div>
      )}
    </div>
  );
}
