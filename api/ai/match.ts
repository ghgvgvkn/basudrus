export const config = { runtime: "edge" };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOWED_ORIGINS = ["https://basudrus.com", "https://www.basudrus.com", "https://basudrus.vercel.app"];

function secHeaders(origin?: string | null) {
  const h: Record<string, string> = { "X-Content-Type-Options": "nosniff" };
  if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }
  return h;
}

export default async function handler(req: Request) {
  const origin = req.headers.get("origin");
  const sH = secHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sH });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: sH });
  }

  try {
    const { myProfile, candidates } = await req.json();

    if (!myProfile || !candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ scores: [] }), { status: 200 });
    }

    const candidateList = candidates.slice(0, 15).map((c: any, i: number) => (
      `${i + 1}. ID: "${c.id}" | Name: ${c.name} | Uni: ${c.uni} | Major: ${c.major} | Year: ${c.year} | Meet: ${c.meet_type} | Courses: ${c.course || "none"} | Bio: ${(c.bio || "").slice(0, 100)}`
    )).join("\n");

    const prompt = `You are the Smart Match engine inside Bas Udrus — a study partner platform for Jordanian university students. Your job is to find the BEST study partners, not just similar profiles.

═══════════════════════════════════════════
MY PROFILE
═══════════════════════════════════════════
- Name: ${myProfile.name}
- University: ${myProfile.uni}
- Major: ${myProfile.major}
- Year: ${myProfile.year}
- Meet preference: ${myProfile.meet_type}
- Courses: ${myProfile.course || "none"}
- Bio: ${(myProfile.bio || "").slice(0, 150)}

═══════════════════════════════════════════
CANDIDATES
═══════════════════════════════════════════
${candidateList}

═══════════════════════════════════════════
SCORING RULES (be generous but honest)
═══════════════════════════════════════════
- Same university = +25 points (they can meet on campus, share resources)
- Same major = +20 points (same courses, same professors, same struggles)
- Same year = +10 points (taking same courses NOW)
- Matching/overlapping courses = +25 points (the #1 reason to study together)
- Compatible meet type = +10 points (both online, both face, or either is flexible)
- Similar bio interests/needs = +10 points (both mention same topic, similar study style)
- Cross-major bonus: +5 if different majors but complementary (CS student + Math student, Business + Economics)
- Score range: 0-100

═══════════════════════════════════════════
JORDANIAN CONTEXT
═══════════════════════════════════════════
- Same city matters: UJ students can easily meet, but UJ + JUST (Amman + Irbid) is harder in person
- Understand Jordanian university culture: study groups are crucial, especially before finals
- "Flexible" meet type is the most compatible — it matches with everything

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════
Return ONLY a valid JSON array, no explanation, no markdown:
[{"id":"...","score":85,"reason":"Same major, 2 shared courses, both at UJ"},{"id":"...","score":60,"reason":"Same uni, different major but both need calc help"}]

Sort by score descending. Include ALL candidates.`;

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
