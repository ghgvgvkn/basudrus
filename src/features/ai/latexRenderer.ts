/**
 * latexRenderer — lazy KaTeX loader + safe formula renderer.
 *
 * The AI frequently emits LaTeX inline ($V = \frac{W}{Q}$) and as
 * display blocks ($$ \int_0^\infty e^{-x} dx = 1 $$). Without a real
 * math renderer the student sees the raw source and has to mentally
 * decode \frac and \int — exactly the cognitive friction this app is
 * supposed to remove.
 *
 * KaTeX is the standard answer (faster than MathJax, no runtime
 * config, ships clean HTML). We don't pay its ~270KB cost up front —
 * the module + CSS are dynamically imported the first time a chat
 * actually contains math, then cached for the rest of the session.
 *
 * Safety:
 *   - `trust: false` blocks LaTeX commands that can leak into HTML
 *     attributes (\href, \url, \includegraphics, \htmlClass, …).
 *   - `strict: "ignore"` suppresses warnings on unknown commands so
 *     ChatGPT-style sloppy LaTeX doesn't blank out the bubble.
 *   - `throwOnError: false` makes broken LaTeX render as a tiny red
 *     marker rather than crashing — the student can ask the AI to
 *     try again.
 *   - The output is HTML produced by KaTeX itself, never user-typed
 *     HTML, so dangerouslySetInnerHTML is the safe hatch here.
 *
 * Public surface:
 *   - `loadKatex()`  → resolves once KaTeX + CSS are ready.
 *   - `tryRenderMath(src, display)` → string | null. Synchronous;
 *     returns null until KaTeX has been loaded at least once.
 *   - `useKatexReady()` → React hook that flips to true once KaTeX
 *     has finished loading. Used to re-render bubbles after a
 *     just-in-time load completes.
 */
import { useEffect, useState } from "react";

// Module-level cache so we only load once per page lifetime.
type KatexModule = typeof import("katex");
let katexCached: KatexModule["default"] | null = null;
let katexPromise: Promise<KatexModule["default"]> | null = null;

// Listeners notified once KaTeX finishes loading. Components subscribe
// via useKatexReady() so a chat bubble that rendered before the chunk
// arrived can re-run its formatting now that we can produce real HTML.
const readyListeners = new Set<() => void>();

/** Kick off (or return the in-flight promise for) the KaTeX import.
 *  Resolves to KaTeX's default export. */
export function loadKatex(): Promise<KatexModule["default"]> {
  if (katexCached) return Promise.resolve(katexCached);
  if (katexPromise) return katexPromise;
  katexPromise = (async () => {
    // CSS is bundled into the chunk via Vite's CSS import handling —
    // no runtime <link> insertion needed; Vite rewrites the
    // `fonts/KaTeX_*.woff2` paths to fingerprinted asset URLs and
    // injects the rules when this chunk loads.
    await import("katex/dist/katex.min.css");
    const mod = await import("katex");
    katexCached = mod.default;
    // Notify any bubbles that rendered text-only mid-load.
    for (const fn of readyListeners) {
      try { fn(); } catch { /* never block the cascade */ }
    }
    return katexCached;
  })();
  return katexPromise;
}

/** Render a LaTeX source string to HTML, or null if KaTeX isn't
 *  loaded yet (in which case the caller should show plain text and
 *  trigger loadKatex() so the next render uses real math). */
export function tryRenderMath(src: string, displayMode: boolean): string | null {
  if (!katexCached) return null;
  try {
    return katexCached.renderToString(src, {
      displayMode,
      // Don't crash on bad syntax — show a small marker the student
      // can flag to the AI ("that didn't render, try again").
      throwOnError: false,
      // strict: "ignore" → unknown commands are rendered verbatim
      // instead of warning. Good when the AI guesses at exotic macros.
      strict: "ignore",
      // trust: false → block any command that could place arbitrary
      // HTML/URL content into the output (\href, \url, \htmlData…).
      // This is the difference between "safe to dangerouslySetInnerHTML"
      // and "XSS waiting to happen."
      trust: false,
      output: "html",
    });
  } catch {
    return null;
  }
}

/** React hook — flips true the first time KaTeX has loaded. Use it to
 *  trigger a re-render of a bubble after a just-in-time chunk arrival. */
export function useKatexReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => katexCached !== null);
  useEffect(() => {
    if (katexCached) {
      // Already loaded by the time this component mounted.
      if (!ready) setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    readyListeners.add(onReady);
    // If we haven't started loading yet, start now — the existence of
    // a hook subscriber means at least one bubble wants math.
    void loadKatex();
    return () => { readyListeners.delete(onReady); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ready;
}
