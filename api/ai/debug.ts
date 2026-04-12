export const config = { runtime: "edge" };

export default async function handler() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  const keyInfo = key
    ? `Set (${key.length} chars, starts with "${key.slice(0, 7)}...")`
    : "NOT SET";

  let apiTest = "not tested";
  if (key) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        }),
      });
      if (res.ok) {
        apiTest = "SUCCESS — API key works and model is valid";
      } else {
        const errText = await res.text();
        apiTest = `FAILED (${res.status}): ${errText.slice(0, 500)}`;
      }
    } catch (e: any) {
      apiTest = `FETCH ERROR: ${e.message || String(e)}`;
    }
  }

  return new Response(
    JSON.stringify({ keyInfo, apiTest, timestamp: new Date().toISOString() }, null, 2),
    { headers: { "Content-Type": "application/json" } }
  );
}
