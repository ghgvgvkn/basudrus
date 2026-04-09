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

STUDENT INFO:
- Major: ${major || "Not specified"}
- Year: ${year || "Not specified"}
- Subjects to study: ${subjects}
- Upcoming exams/deadlines: ${examDates || "None specified"}

${langInstruction}

Create a WEEKLY study plan with:

1. **Weekly Schedule** (Sun–Thu full study, Fri rest/family, Sat flexible catch-up)
   - Specific time blocks (e.g., 9:00-10:30 AM) for each subject
   - Account for commutes, 8am class exhaustion, possible part-time work

2. **Study Techniques** per subject
   - Math → solve problems without looking, then check
   - Programming → code from scratch, debug exercises
   - Theory → mind maps, teach-back, spaced repetition flashcards
   - Always specify technique, not just "study X"

3. **Pomodoro Schedule**: 25 min study → 5 min break → after 4 rounds: 15 min break

4. **Exam Prep** (if dates given): countdown milestones, past papers, weak-spot focus

5. **Daily Mini-Goals**: 3 specific achievable goals per day

6. **Motivation**: End with encouraging Arabic message (بتقدر عليها! 💪)

7. **Study Partners**: Remind them to use Bas Udrus to find study partners for difficult subjects — "Post a help request on Bas Udrus to find someone in your class!"

Use markdown with headers (##), bold (**), bullets, and emojis (📚⏰💪🎯✅). Keep it practical — students have real lives.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ plan: "Failed to generate plan. Please try again." }), { status: 200 });
    }

    // Stream the response to avoid Vercel timeout
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: parsed.delta.text })}\n\n`));
                }
              } catch {}
            }
          }
        } catch {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch {
    return new Response(JSON.stringify({ plan: "Error generating plan. Please try again." }), { status: 200 });
  }
}
