export const config = { runtime: "edge" };

export default async function handler() {
  const rawKey = process.env.ANTHROPIC_API_KEY || "";
  const key = rawKey.trim(); // Strip any whitespace

  const keyDiag = {
    length: rawKey.length,
    trimmedLength: key.length,
    hasLeadingSpace: rawKey !== rawKey.trimStart(),
    hasTrailingSpace: rawKey !== rawKey.trimEnd(),
    hasNewline: rawKey.includes("\n") || rawKey.includes("\r"),
    hasQuotes: rawKey.includes('"') || rawKey.includes("'"),
    first10: key.slice(0, 10),
    last5: key.slice(-5),
  };

  // Test 1: Try with the current model
  let test1 = "not run";
  if (key) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2025-01-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        }),
      });
      if (res.ok) {
        test1 = "SUCCESS";
      } else {
        const errText = await res.text();
        test1 = `FAILED (${res.status}): ${errText.slice(0, 300)}`;
      }
    } catch (e: any) {
      test1 = `ERROR: ${e.message}`;
    }
  }

  // Test 2: Try with older API version + older model as fallback
  let test2 = "not run";
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
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        }),
      });
      if (res.ok) {
        test2 = "SUCCESS";
      } else {
        const errText = await res.text();
        test2 = `FAILED (${res.status}): ${errText.slice(0, 300)}`;
      }
    } catch (e: any) {
      test2 = `ERROR: ${e.message}`;
    }
  }

  return new Response(
    JSON.stringify({ keyDiag, test1_sonnet46: test1, test2_sonnet35: test2, timestamp: new Date().toISOString() }, null, 2),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
