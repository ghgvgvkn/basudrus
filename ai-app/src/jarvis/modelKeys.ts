/**
 * Model key resolution — tiny pure-string module, NO three.js dep.
 *
 * Extracted from JarvisView.tsx so the AuroraAIScreen (and the
 * artifact parser) can import resolveModelKey without dragging in
 * the entire R3F + Three.js bundle. The full JarvisView (which
 * does pull those in) is lazy-loaded only when a user opens a
 * model.
 *
 * Keep this list IN SYNC with the MODEL_REGISTRY in JarvisView.tsx.
 * If they drift, resolveModelKey would say "yes I know this model"
 * but the viewer would have no matching component.
 */

const KNOWN_MODELS = [
  "atom",
  "solar-system",
  "dna",
  "water",
  "animal-cell",
  "heart",
] as const;

export type ModelKey = typeof KNOWN_MODELS[number];

const ALIASES: Record<string, ModelKey> = {
  "h2o": "water",
  "molecule": "water",
  "cell": "animal-cell",
  "human-cell": "animal-cell",
  "human-heart": "heart",
  "ss": "solar-system",
  "solarsystem": "solar-system",
};

/** Normalize a free-form model name (what Tony emits inside the
 *  <<<MODEL:...>>> block) into one of our known keys, or return
 *  null if it doesn't match anything. */
export function resolveModelKey(name: string): ModelKey | null {
  const k = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (KNOWN_MODELS.includes(k as ModelKey)) return k as ModelKey;
  return ALIASES[k] ?? null;
}
