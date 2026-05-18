/**
 * groq.ts — Groq streaming client for Bas Udrus.
 *
 * Groq runs open-weight models (Llama 4, Kimi K2, Qwen, DeepSeek) on
 * their own LPU hardware. Their API is OpenAI-compatible, which means
 * we translate our Anthropic-shaped message stack to OpenAI shape on
 * the way out, and translate OpenAI SSE chunks back to Anthropic-
 * compatible content_block_delta frames on the way in. The result is
 * a drop-in replacement at the *transport* layer — every downstream
 * consumer (tutor.ts SSE handler, the client useStreamingAI hook) keeps
 * its existing parsing logic untouched.
 *
 * Why Groq:
 *   - Generous free tier (~14,400 requests/day on Llama 4 Maverick,
 *     no credit card needed)
 *   - 350-600 tok/s — students feel the answer come back instantly
 *   - Free or near-free for the dominant chat path, which lets us
 *     keep Anthropic budget for the things only Anthropic does well
 *     (vision uploads, native PDF document API, Sherlock's safety tuning)
 *
 * Format translation rules (Anthropic → OpenAI):
 *   - Anthropic: { system, messages[] }
 *     where messages[i].content is string OR a list of content blocks
 *     ({ type: "text", text } | { type: "image", source } | ...)
 *   - OpenAI: messages[] with system as the first message
 *     content is always a string (we flatten content blocks to plain
 *     text — multimodal blocks are not supported on Llama 4 Maverick
 *     via Groq, and the router should never have sent us a multimodal
 *     request anyway)
 *
 * SSE translation (OpenAI → Anthropic-flavored):
 *   - OpenAI chunk: { choices: [{ delta: { content } }] }
 *   - We re-emit: { type: "content_block_delta", delta: { text } }
 *     so the downstream SSE loop in tutor.ts (which already handles
 *     this shape) doesn't need to branch on provider.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Default Groq model. Llama 4 Maverick is the best general model on
 *  Groq's free tier today — Haiku-equivalent quality, ~5x faster,
 *  generous free tier. Kimi K2 is stronger on math/code; switch via
 *  GROQ_MODEL env var if needed. */
export const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";

export interface AnthropicTextBlock { type: "text"; text: string }
export interface AnthropicContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface CallGroqArgs {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  /** Forwarded into fetch so the upstream Groq call aborts when the
   *  client disconnects mid-stream (same pattern as tutor.ts uses for
   *  Anthropic — keeps token billing honest). */
  signal?: AbortSignal;
}

/** Flatten Anthropic content blocks down to a single plain-text string.
 *  Llama 4 Maverick via Groq is text-only, so any non-text blocks (image,
 *  document) are dropped with a placeholder marker — the routing layer
 *  should have routed those requests to Anthropic in the first place. */
function flattenContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "image") return "[image attachment — viewer cannot see in this model]";
      if (b.type === "document") return "[PDF attachment — viewer cannot see in this model]";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Convert our Anthropic-shaped message list to OpenAI shape — system
 *  becomes the first message, content blocks get flattened. */
function toOpenAIMessages(systemPrompt: string, msgs: AnthropicMessage[]) {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  for (const m of msgs) {
    out.push({ role: m.role, content: flattenContent(m.content) });
  }
  return out;
}

/**
 * callGroqStream — call Groq's streaming chat completions endpoint and
 * return the raw Response. The body is an OpenAI-format SSE stream;
 * the consumer is expected to read it via `Response.body.getReader()`
 * and feed each line through `translateGroqChunkToAnthropic()`.
 *
 * Errors are surfaced as a non-ok Response (status + readable body).
 * Caller decides whether to fall back to Anthropic.
 */
export async function callGroqStream(args: CallGroqArgs): Promise<Response> {
  const { apiKey, model = DEFAULT_GROQ_MODEL, systemPrompt, messages, maxTokens = 2048, signal } = args;
  const openAIMessages = toOpenAIMessages(systemPrompt, messages);
  return fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openAIMessages,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  });
}

/**
 * translateGroqChunkToAnthropic — given a single SSE `data: ...` line
 * from Groq's OpenAI stream, return either:
 *   - { text: string }  — a fragment of assistant text to enqueue
 *   - null              — control frame (`[DONE]`, role announce,
 *                          finish_reason, etc.) — skip
 *
 * This lets tutor.ts use one consistent enqueue path regardless of
 * provider: every chunk just becomes a `content_block_delta`-shaped
 * frame the client already knows how to parse.
 */
export function translateGroqChunkToAnthropic(line: string): { text: string } | null {
  if (!line.startsWith("data: ")) return null;
  const data = line.slice(6).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
    };
    const fragment = parsed.choices?.[0]?.delta?.content;
    if (typeof fragment === "string" && fragment.length > 0) {
      return { text: fragment };
    }
  } catch {
    // Malformed line — skip silently. SSE is best-effort.
  }
  return null;
}
