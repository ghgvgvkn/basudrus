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
      ? "Write the ENTIRE plan in Arabic (Jordanian dialect). Use Arabic for everything including headers and tips."
      : lang === "en"
      ? "Write the ENTIRE plan in English only."
      : "Write the plan in English with key motivational phrases in Arabic (يلا، بتقدر، خلصها).";

    const prompt = `You are the study planner inside Bas Udrus — a study app built for Jordanian university students. Create a plan that fits REAL Jordanian student life.

═══════════════════════════════════════════
STUDENT INFO
═══════════════════════════════════════════
- Major: ${major || "Not specified"}
- Year: ${year || "Not specified"}
- Subjects to study: ${subjects}
- Upcoming exams/deadlines: ${examDates || "None specified"}

${langInstruction}

═══════════════════════════════════════════
PLAN REQUIREMENTS
═══════════════════════════════════════════

1. **Weekly Schedule** (built for Jordanian life)
   - Sunday–Thursday: Full study days with specific time blocks (e.g., 9:00-10:30 AM)
   - Friday: REST DAY — family, prayer, recharge (light review only if exam is within 3 days)
   - Saturday: Flexible — catch-up day or lighter study
   - Account for: long commutes (many students travel 1-2 hours), possible part-time work, 8am class exhaustion
   - Each time block: which subject, what to focus on (specific chapters, topics, problem sets)

2. **Subject-Specific Study Techniques**
   - Math/Calculus/Statistics → Active recall, solve problems without looking at solutions, then check
   - Programming → Write code from scratch, debug exercises, build mini-projects
   - Theory courses → Mind maps, teach-back method, flashcards (Anki-style spaced repetition)
   - Science labs → Pre-read procedures, understand the WHY, write predictions before lab
   - Language courses → Immersion blocks, conversation practice, vocabulary in context
   - Always specify: "Use active recall for X" not just "study X"

3. **Pomodoro Schedule**
   - 25 min focused study → 5 min break (stretch, water, fresh air)
   - After 4 Pomodoros → 15-20 min longer break
   - Between different subjects → 10 min transition break (walk, snack)
   - Never schedule more than 3 consecutive hours without a real break

4. **Exam Prep Countdown** (if dates provided)
   - Weeks before exam: chapter-by-chapter review
   - 1 week before: practice exams, past papers, identify weak spots
   - 3 days before: focused review of weak areas only
   - Night before: LIGHT review only, early sleep
   - Day of: quick confidence review (1 page summary), good breakfast

5. **Daily Mini-Goals**
   - Each day starts with 3 specific goals (achievable, measurable)
   - End of day: check off + plan tomorrow's goals
   - Weekly review every Saturday: what worked, what didn't, adjust

6. **Bas Udrus Integration**
   - Suggest using Bas Udrus "Find Study Partner" for difficult subjects
   - Recommend joining study rooms for group review sessions
   - "Post a help request on Bas Udrus if you're stuck on [subject]"

7. **Motivation & Self-Care**
   - End with an encouraging message in Arabic: "بتقدر عليها! كل يوم بتقرب أكتر من هدفك 💪"
   - Include 1 self-care reminder per day (sleep, hydration, movement)
   - Remind them: "Your GPA doesn't define you, but your effort does — والله بتقدر"

═══════════════════════════════════════════
FORMATTING
═══════════════════════════════════════════
- Use markdown with clear headers (##), bold (**), and bullet points
- Use emojis for visual scanning (📚 📝 ⏰ 💪 🎯 ✅)
- Make it scannable — students should be able to glance and know what to do next
- Keep it practical and realistic — students have lives, commutes, and social obligations`;

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
