/**
 * connectActions — small helpers that wrap "Say hi" / "Help them"
 * into a real `connections` row, plus the localStorage handoff
 * that ConnectScreen reads on mount.
 *
 * Why a helper rather than inline code:
 *   - Two screens (Home + Discover) trigger this exact flow
 *   - Production has a `connections` row PER DIRECTION (asymmetric).
 *     Saying hi inserts the row from this user → partner. The
 *     partner has to say hi back to make it bidirectional.
 *
 * The localStorage hint (bu:open-thread) is read by ConnectScreen
 * on mount, opens the right thread, then is cleared.
 *
 * RLS on connections: connections_insert_own (user_id = auth.uid()).
 */
import { supabase } from "@/lib/supabase";
import { getSessionCached } from "@/lib/supabase";

export interface ConnectTarget {
  id: string;
  name: string;
  avatar_color?: string | null;
}

/** Create the real connection row (idempotent — upsert) and stash
 *  the localStorage hint so ConnectScreen opens the right DM. */
export async function startConversation(target: ConnectTarget): Promise<{ ok: boolean; error?: string }> {
  // Localstorage hint runs whether or not the DB write succeeds —
  // we still want the UI to land on the chat.
  try {
    window.localStorage.setItem("bu:open-thread", `dm:${target.id}`);
    window.localStorage.setItem(
      "bu:open-thread-meta",
      JSON.stringify({
        id: target.id,
        name: target.name,
        avatar_color: target.avatar_color ?? "#5B4BF5",
      }),
    );
  } catch { /* storage unavailable — fine, ConnectScreen will land on the list */ }

  if (!supabase) return { ok: false, error: "No Supabase client" };

  const { data: { session } } = await getSessionCached();
  if (!session?.user) {
    // Not signed in. The localStorage hint is set but ConnectScreen
    // will hit the SignInGate first.
    return { ok: false, error: "Not signed in" };
  }

  try {
    // Upsert pattern — if the user already said hi to this person
    // before, no-op. Otherwise create the row. The unique constraint
    // (user_id, partner_id) is what makes onConflict work.
    const { error } = await supabase
      .from("connections")
      .upsert({
        user_id: session.user.id,
        partner_id: target.id,
      }, { onConflict: "user_id,partner_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
