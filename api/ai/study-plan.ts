export const config = { runtime: "edge" };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { subjects, major, year, examDates, lang } = await req.json();

    if (!subjects) {
      return new Response(JSON.stringify({ plan: "" }), { status: 200 });
    }

    const langInstruction = lang === "ar"
      ? "Write the ENTIRE plan in Arabic (Jordanian dialect). Use Arabic for everything."
      : lang === "en"
      ? "Write the ENTIRE plan in English only."
      : "Write the plan in English with key motivational phrases in Arabic.";

    const prompt = `You are a study planner for a Jordanian university student.

STUDENT INFO:
- Major: ${major || "Not specified"}
- Year: ${year || "Not specified"}
- Subjects to study: ${subjects}
- Upcoming exams/deadlines: ${examDates || "None specified"}

${langInstruction}

Create a detailed, realistic WEEKLY study plan. Include:

1. **Daily schedule** (Sunday–Thursday, with lighter Friday/Saturday)
   - Specific time blocks (e.g., 9:00-10:30 AM)
   - Which subject in each block
   - What to focus on (chapters, topics, problem sets)

2. **Study techniques** for each subject
   - Active recall, practice problems, flashcards, etc.
   - Specific to the subject type (math → problems, theory → mind maps)

3. **Break schedule**
   - Pomodoro blocks (25 min study, 5 min break)
   - Longer breaks between subjects

4. **Exam prep** (if dates provided)
   - Countdown with milestones
   - Review sessions before each exam

5. **Motivation tip** at the end (in Arabic if the student is Jordanian)

Keep it practical and realistic — students have lives too. Use markdown formatting.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ plan: "Failed to generate plan. Please try again." }), { status: 200 });
    }

    const data = await response.json();
    const plan = data.content?.[0]?.text || "Failed to generate plan.";

    return new Response(JSON.stringify({ plan }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ plan: "Error generating plan. Please try again." }), { status: 200 });
  }
}
