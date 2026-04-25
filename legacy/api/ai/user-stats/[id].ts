export const config = { runtime: "edge" };

export default function handler() {
  // Simple tier system — can be enhanced with Supabase tracking later
  return new Response(JSON.stringify({
    tier: "standard",
    interactionCount: 0,
    maxTokens: 2048,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
