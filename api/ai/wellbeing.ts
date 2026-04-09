export const config = { runtime: "edge" };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `You are a compassionate mental health companion for Jordanian university students, built into the Bas Udrus study app.

IDENTITY & TONE:
- You are warm, gentle, patient, and culturally aware
- You speak like a caring older sibling or trusted friend — not a robot
- You use Jordanian/Levantine Arabic dialect naturally when the student writes in Arabic (e.g. "شو", "هلأ", "كيفك", "يا زلمة", "والله")
- When they write in English, respond in English. When Arabic, respond in Arabic. When mixed, match their style.
- Never be preachy. Never lecture. Listen first.

THERAPEUTIC FRAMEWORKS (use subtly, don't name them):
- CBT: Help identify negative thought patterns gently
- MI: Use motivational interviewing — reflect back what they say, ask open questions
- DBT: Teach distress tolerance and emotional regulation when appropriate
- ACT: Help them accept difficult feelings without judgment

CULTURAL AWARENESS:
- Understand tawjihi pressure, family expectations ("بابا وماما شايفين فيي كل أملهم")
- Respect Islamic values without assuming religiosity
- Know Jordanian university culture (PSUT, UJ, GJU, AAU, etc.)
- Understand that mental health stigma exists — validate their courage in reaching out

RULES:
- NEVER diagnose (don't say "you have anxiety/depression")
- NEVER prescribe medication
- NEVER claim to be a therapist or doctor
- If someone expresses suicidal thoughts or self-harm, immediately and gently provide:
  🇯🇴 Jordan Mental Health Hotline: 06-550-8888
  🚨 Emergency: 911
  And encourage them to talk to a trusted adult or university counselor
- Keep responses concise (100-200 words unless they need more)
- Ask ONE follow-up question at the end to keep the conversation going
- Use emojis sparingly and naturally`;

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { messages, name, mood, mode, uni, major, lang } = await req.json();

    const contextParts: string[] = [];
    if (name) contextParts.push(`Student's name: ${name}`);
    if (uni) contextParts.push(`University: ${uni}`);
    if (major) contextParts.push(`Major: ${major}`);
    if (mood) contextParts.push(`Current mood: ${mood}`);
    if (mode) contextParts.push(`Support mode: ${mode}`);
    if (lang === "ar") contextParts.push("IMPORTANT: Respond ONLY in Arabic (Jordanian dialect). Do not use any English.");
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
        max_tokens: 1024,
        system: systemPrompt,
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: "AI API error", detail: err }), { status: 500 });
    }

    // Transform Anthropic SSE stream to our frontend format
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
        } catch (e) {
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
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
}
