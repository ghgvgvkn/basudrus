export const config = { runtime: "edge" };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { myProfile, candidates } = await req.json();

    if (!myProfile || !candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ scores: [] }), { status: 200 });
    }

    const candidateList = candidates.slice(0, 15).map((c: any, i: number) => (
      `${i + 1}. ID: "${c.id}" | Name: ${c.name} | Uni: ${c.uni} | Major: ${c.major} | Year: ${c.year} | Meet: ${c.meet_type} | Courses: ${c.course || "none"} | Bio: ${(c.bio || "").slice(0, 100)}`
    )).join("\n");

    const prompt = `You are a study partner matching algorithm. Score how compatible each candidate is with the student below.

MY PROFILE:
- Name: ${myProfile.name}
- University: ${myProfile.uni}
- Major: ${myProfile.major}
- Year: ${myProfile.year}
- Meet preference: ${myProfile.meet_type}
- Courses: ${myProfile.course || "none"}
- Bio: ${(myProfile.bio || "").slice(0, 100)}

CANDIDATES:
${candidateList}

SCORING RULES:
- Same university = +20 points
- Same major = +15 points
- Same year = +10 points
- Matching courses = +25 points
- Compatible meet type = +10 points
- Similar bio interests = +10 points
- Score 0-100

Return ONLY a JSON array, no explanation:
[{"id":"...","score":85,"reason":"Same major, 2 shared courses"},{"id":"...","score":60,"reason":"Same uni, different major but compatible schedule"}]`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ scores: [] }), { status: 200 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "[]";

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    let scores = [];
    if (jsonMatch) {
      try { scores = JSON.parse(jsonMatch[0]); } catch {}
    }

    return new Response(JSON.stringify({ scores }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ scores: [] }), { status: 200 });
  }
}
