export const config = { runtime: "edge" };

export default function handler() {
  return new Response(JSON.stringify({
    version: "v2.0",
    model: "claude-haiku-4-5 (smart tier on hard/crisis turns)",
    features: ["tutor", "wellbeing", "match", "study-plan"],
    updated: "2026-07-02",
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
