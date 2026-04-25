/**
 * messageBg — lightweight metadata + CSS fallback for AI message
 * artifacts. The ACTUAL 3D rendering lives in messageBg3d.ts and is
 * dynamic-imported on first use, because Three.js is ~500KB and
 * shouldn't bloat the initial AIScreen chunk.
 *
 * What stays here:
 *   - fallbackGradient(): pure CSS gradient string used as the
 *     instant placeholder (and the permanent visual on devices
 *     where Three.js fails to load — older phones, no-WebGL).
 *   - inferSubject(): tiny keyword classifier; no THREE needed.
 *   - hash(): the deterministic-string hashing helper that BOTH
 *     fallbackGradient and the 3D renderer depend on (so identical
 *     seeds produce identical results in both code paths).
 *
 * Iteration history: prior version included Three.js scene builders
 * inline. Splitting them out cut the AIScreen chunk from 519 KB to
 * ~25 KB initial; THREE loads in parallel as a separate ~470 KB
 * chunk that's cached separately and only fetched once a real AI
 * message renders.
 */
import type { AIPersona, AISubject } from "@/shared/types";

/** Deterministic 0..1 from any string. Shared with messageBg3d so
 *  fallback gradient and rendered artifact always agree on seed. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** CSS gradient placeholder — instant, no Three.js. Used:
 *   1. As the immediate visual when an AI message renders, so
 *      there's never a blank box waiting for the 3D artifact.
 *   2. As the permanent visual on devices where the dynamic THREE
 *      import fails (rare — old phones, ad blockers, no-WebGL).
 *   3. In the message bubble's `background-image` layer underneath
 *      the rendered PNG so transparent-edge artifacts blend in.
 */
export function fallbackGradient(messageId: string, persona: AIPersona): string {
  const seed = hash(messageId);
  const base = persona === "omar" ? 255 : 155;
  const h1 = base + Math.round(seed * 30);
  const h2 = base + Math.round(seed * 60) + 20;
  return `linear-gradient(${Math.round(seed * 360)}deg, hsl(${h1} 70% 55%), hsl(${h2} 55% 50%))`;
}

/**
 * Infer an AISubject from a free-text question. Keyword lookup — the
 * live port should pass this field from the server after classifying
 * the user's message, but this client-side heuristic is enough for
 * the demo bundle and keeps every message visually distinct.
 */
export function inferSubject(text: string, persona: AIPersona): AISubject {
  if (persona === "noor") return "wellbeing";
  const t = text.toLowerCase();
  if (/math|algebra|calculus|geometry|trig|derivative|integral|matrix|vector/.test(t)) return "math";
  if (/code|coding|program|algorithm|data structure|python|javascript|typescript|react|sql|compiler|os/.test(t)) return "cs";
  if (/bio|cell|dna|evolution|photosynthesis|organism|protein|gene|mitochon/.test(t)) return "biology";
  if (/chem|reaction|atom|molec|bond|periodic|acid|base|mole |stoich/.test(t)) return "chemistry";
  if (/physics|newton|force|energy|momentum|quantum|relativ|wave|current|voltage|magnet/.test(t)) return "physics";
  if (/english|french|arabic|spanish|german|grammar|verb|noun|tense|essay|translate/.test(t)) return "languages";
  if (/history|war|revolution|ancient|empire|dynasty|century/.test(t)) return "history";
  return "general";
}
