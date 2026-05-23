/**
 * useJudgmentApi — thin client for /api/ai/judgment.
 *
 * One hook, five methods matching the edge function's actions.
 * Every call:
 *  - Reads the auth token via supabase.auth.getSession()
 *  - POSTs to apiUrl("/api/ai/judgment") so it works from both
 *    basudrus.com (same-origin) and Aurora (cross-origin)
 *  - Returns a discriminated union for ok / error
 *
 * No global loading state — each caller can manage its own loading
 * flag if it needs one.
 */
import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/apiBase";

// ── Shared types ───────────────────────────────────────────────────

export type JudgmentStatus = "waiting" | "both_in" | "active" | "complete" | "expired";

export interface Judgment {
  id: string;
  invite_code: string;
  relationship_type: string;
  title: string | null;
  party_a_user_id: string;
  party_a_label: string | null;
  party_b_user_id: string | null;
  party_b_label: string | null;
  status: JudgmentStatus;
  created_at: string;
  updated_at: string;
  // Verdict fields (kept for backwards-compat with v1; new
  // chat-mode treats verdicts as AI messages w/ a header block).
  verdict_text?: string | null;
  verdict_sides_with?: "a" | "b" | "both" | "neither" | null;
  verdict_generated_at?: string | null;
}

export interface JudgmentMessage {
  id: string;
  sender_type: "party_a" | "party_b" | "ai";
  sender_user_id: string | null;
  text: string;
  created_at: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Internals ──────────────────────────────────────────────────────

/** Get an Authorization header from the current Supabase session,
 *  or null if the user isn't signed in. */
async function getAuthHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

/** Generic POST to /api/ai/judgment with action payload. */
async function postJudgment<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  const auth = await getAuthHeader();
  if (!auth) return { ok: false, error: "Sign in to use judgment" };
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ai/judgment"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
  let payload: Record<string, unknown> = {};
  try { payload = (await res.json()) as Record<string, unknown>; } catch { /* tolerate empty bodies */ }
  if (!res.ok) {
    const errMsg = typeof payload.error === "string" ? payload.error : `Server returned ${res.status}`;
    return { ok: false, error: errMsg };
  }
  return { ok: true, data: payload as T };
}

// ── Public hook ────────────────────────────────────────────────────

export function useJudgmentApi() {
  /** A starts a judgment + posts their first message in one shot. */
  const create = useCallback(
    async (opts: {
      relationshipType: string;
      title?: string;
      partyALabel?: string;
      text: string;
    }): Promise<ApiResult<{ judgment: Judgment }>> => {
      return postJudgment<{ judgment: Judgment }>({
        action: "create",
        ...opts,
      });
    },
    [],
  );

  /** B joins an existing judgment by invite code, posting their
   *  first message blind. */
  const join = useCallback(
    async (opts: {
      inviteCode: string;
      partyBLabel?: string;
      text: string;
    }): Promise<ApiResult<{ judgment: Judgment }>> => {
      return postJudgment<{ judgment: Judgment }>({
        action: "join",
        ...opts,
      });
    },
    [],
  );

  /** Either party posts a follow-up message into the live chat. */
  const postMessage = useCallback(
    async (opts: { judgmentId: string; text: string }): Promise<ApiResult<{ message: JudgmentMessage }>> => {
      return postJudgment<{ message: JudgmentMessage }>({
        action: "post_message",
        ...opts,
      });
    },
    [],
  );

  /** Either party asks Tony to respond. Server reads the whole
   *  transcript, runs Anthropic, posts Tony's reply into the chat. */
  const askAi = useCallback(
    async (opts: { judgmentId: string }): Promise<ApiResult<{ message: JudgmentMessage }>> => {
      return postJudgment<{ message: JudgmentMessage }>({
        action: "ai_respond",
        ...opts,
      });
    },
    [],
  );

  /** Fetch the whole transcript for a judgment. RLS-gated: only
   *  participants get rows back. */
  const listMessages = useCallback(
    async (opts: { judgmentId: string }): Promise<ApiResult<{ messages: JudgmentMessage[] }>> => {
      return postJudgment<{ messages: JudgmentMessage[] }>({
        action: "list_messages",
        ...opts,
      });
    },
    [],
  );

  return { create, join, postMessage, askAi, listMessages };
}

/**
 * Look up a judgment by invite_code without joining — used by the
 * Join screen to show "Alice wants Tony to weigh in" before Bob
 * actually submits anything. Goes directly to Supabase REST + the
 * judgment_peek_for_join security-definer RPC.
 */
export async function peekJudgmentByCode(
  inviteCode: string,
): Promise<ApiResult<{
  id: string;
  invite_code: string;
  relationship_type: string;
  title: string | null;
  party_a_label: string | null;
  status: JudgmentStatus;
  is_party_a: boolean;
}>> {
  const auth = await getAuthHeader();
  if (!auth) return { ok: false, error: "Sign in first" };
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, error: "Supabase not configured" };
  }
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/judgment_peek_for_join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: auth,
      },
      body: JSON.stringify({ p_invite_code: inviteCode }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
  if (!res.ok) {
    return { ok: false, error: `Lookup failed (${res.status})` };
  }
  const rows = (await res.json()) as Array<{
    id: string;
    invite_code: string;
    relationship_type: string;
    title: string | null;
    party_a_label: string | null;
    status: JudgmentStatus;
    is_party_a: boolean;
  }>;
  if (rows.length === 0) {
    return { ok: false, error: "Invite link not found" };
  }
  return { ok: true, data: rows[0] };
}
