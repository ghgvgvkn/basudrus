/**
 * useTutorFeedback — record a thumbs-up / thumbs-down on an AI message.
 *
 * Writes one row into `public.tutor_feedback` with:
 *   • rating ('up' | 'down')
 *   • persona ('omar' | 'noor')
 *   • message_text — snapshot of the AI body that got rated
 *   • user_message_text — snapshot of the user prompt that led to it
 *   • note — optional free-text reason (only on 'down')
 *
 * RLS allows the signed-in user to insert + select their own rows.
 *
 * Fire-and-forget: errors are logged to console but never surface to
 * the student — feedback failing should never block the chat. The
 * caller is responsible for the optimistic local "rated" state so the
 * UI feels instant.
 */
import { useCallback } from "react";
import { supabase } from "@/lib/supabase";

export type FeedbackRating = "up" | "down";
export type FeedbackPersona = "omar" | "noor";

export interface SubmitFeedbackArgs {
  rating: FeedbackRating;
  persona: FeedbackPersona;
  /** The AI message body that got rated. */
  messageText: string;
  /** The user message that produced the rated reply (best-effort). */
  userMessageText?: string | null;
  /** Optional reason from the 👎 note modal. */
  note?: string | null;
}

export function useTutorFeedback() {
  const submit = useCallback(async (args: SubmitFeedbackArgs) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const payload = {
        user_id: user.id,
        rating: args.rating,
        persona: args.persona,
        message_text: trimSnapshot(args.messageText),
        user_message_text: trimSnapshot(args.userMessageText ?? ""),
        note: args.note?.trim() ? args.note.trim().slice(0, 2000) : null,
      };
      const { error } = await supabase.from("tutor_feedback").insert(payload);
      if (error) {
        // Silent — feedback failure must never block the chat.
        console.warn("[tutor_feedback] insert failed:", error.message);
      }
    } catch (err) {
      console.warn("[tutor_feedback] unexpected error:", err);
    }
  }, []);

  return { submit };
}

/** Cap snapshot length so a 50KB markdown reply doesn't bloat the
 *  feedback table. 4000 chars is more than enough context to review
 *  a thumbs-down weekly. */
function trimSnapshot(s: string): string {
  if (!s) return "";
  return s.length > 4000 ? s.slice(0, 4000) + "…" : s;
}
