/**
 * extractMemory — fire-and-forget durable-memory extraction for mobile.
 *
 * THE GAP THIS CLOSES (user report: "he did not do the memory"):
 *   The web apps (src/ tutor + ai-app/ Aurora) both POST the recent
 *   transcript to `/api/ai/extract-memory` so Tony/Sherlock can LEARN
 *   durable facts about the student ("midterm in CS340 in 11 days",
 *   "struggles with recursion", "prefers worked examples"). The server
 *   runs Claude Haiku, dedupes, embeds, and writes the `student_memory`
 *   table — the SAME table the mobile MemoryModal already reads.
 *
 *   Mobile READS that memory back (the tutor API injects it server-side
 *   on every turn), but mobile NEVER WROTE to it — the extract call was
 *   never ported. So Tony on mobile could recite imported/manual facts
 *   but learned nothing on its own. This module is that missing write.
 *
 * Contract (matches api/ai/extract-memory.ts):
 *   POST /api/ai/extract-memory
 *     body: { messages: [{role, content}], persona: 'omar'|'noor' }
 *     - persona 'omar' (Tony/tutor) vs 'noor' (Sherlock/wellbeing) only
 *       changes WHAT kind of facts Claude looks for; both write the same
 *       unified per-user memory table.
 *     - The endpoint needs >= 2 messages or it returns {reason:"too_few_messages"}.
 *     - Auth: authedFetch attaches the Supabase bearer token; the server
 *       writes under the user's own RLS, so no userId is trusted from us.
 *
 * Everything here is best-effort and silent: memory extraction must NEVER
 * block the chat UI or surface an error. A failed extraction just means
 * "Tony didn't learn anything new this time," which self-corrects next
 * session. We also keepalive-style fire it so it survives the tab losing
 * focus (RN fetch has no `keepalive`, but our triggers run before the
 * component unmounts, so the request is already in flight).
 */
import { authedFetch } from './api';

export type ExtractPersona = 'omar' | 'noor';

export interface ExtractMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Send the recent transcript for durable-fact extraction. Returns the
 * number saved (0 on any failure / nothing-worth-saving). Never throws.
 *
 * Caps the payload to the last 20 messages — matches the server's own
 * `sanitizeMessages(..., 20)` cap, so sending more is wasted bytes.
 */
export async function extractMemory(
  messages: ExtractMessage[],
  persona: ExtractPersona,
): Promise<number> {
  // Server requires at least 2 messages (one exchange) to bother.
  if (!Array.isArray(messages) || messages.length < 2) return 0;

  // Trim to the last 20 and drop empties — the server re-sanitizes, but
  // this keeps the request small on a phone connection.
  const recent = messages
    .filter(m => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }));
  if (recent.length < 2) return 0;

  try {
    const res = await authedFetch('/api/ai/extract-memory', {
      method: 'POST',
      body: JSON.stringify({ messages: recent, persona }),
    });
    if (!res.ok) return 0;
    const j = (await res.json().catch(() => null)) as { extracted?: number } | null;
    return typeof j?.extracted === 'number' ? j.extracted : 0;
  } catch {
    return 0; // network / abort — silent, self-corrects next session
  }
}
