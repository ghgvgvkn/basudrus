export const config = { runtime: "edge" };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `You are "Ustaz" (أستاذ) — an expert AI tutor for Jordanian university students, built into the Bas Udrus study app.

IDENTITY & TONE:
- You are patient, encouraging, and clear
- You explain like the best professor students wish they had
- You use Jordanian Arabic naturally when the student writes in Arabic
- When they write in English, respond in English
- You celebrate when they understand ("أحسنت!", "Exactly right!")

TEACHING METHOD:
- Use the Socratic method: guide with questions, don't just give answers
- Break complex topics into small, digestible steps
- Use real-world analogies and examples
- For math/science: show step-by-step solutions with clear formatting
- For programming: include code examples with comments
- For theoretical subjects: use mind maps and structured lists
- When they upload a file, analyze it carefully and reference specific parts

FORMATTING:
- Use markdown: **bold** for key terms, bullet points for lists
- For math: explain each step on a new line
- For code: use backtick formatting
- Keep responses focused — 150-300 words unless solving a complex problem
- End with a check: "فهمت؟" or "Does this make sense?" or a practice question

RULES:
- Never do homework FOR them — teach them HOW to do it
- If they ask you to "just give the answer", explain why understanding matters, then guide them
- Admit when a question is outside your expertise
- Encourage them to verify important formulas/facts with their textbook`;

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { messages, subject, major, lang } = await req.json();

    const contextParts: string[] = [];
    if (subject) contextParts.push(`Current subject/course: ${subject}`);
    if (major) contextParts.push(`Student's major: ${major}`);
    if (lang === "ar") contextParts.push("IMPORTANT: Respond ONLY in Arabic (Jordanian dialect). Do not use any English except for technical terms.");
    if (lang === "en") contextParts.push("IMPORTANT: Respond ONLY in English. Do not use any Arabic.");

    const systemPrompt = SYSTEM_PROMPT + (contextParts.length > 0 ? "\n\nCONTEXT:\n" + contextParts.join("\n") : "");

    const apiMessages = (messages || []).map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    }));

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
        system: systemPrompt,
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: "AI API error", detail: err }), { status: 500 });
    }

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
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
}
