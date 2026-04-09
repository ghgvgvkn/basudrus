export const config = { runtime: "edge" };

export default function handler() {
  return new Response(JSON.stringify({
    version: "v2.0",
    model: "Claude Sonnet",
    features: ["tutor", "wellbeing", "match", "study-plan"],
    updated: "2026-04-08",
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
