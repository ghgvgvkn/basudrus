/**
 * useSupabaseSession — real auth state for the redesign.
 *
 * Returns `{ user, session, loading }` — `user` is the
 * `auth.users` row (id, email, …), `session` is the full
 * JWT-carrying session. While loading, components should render
 * the "signed out" state (guest mode) to avoid a flash.
 *
 * Subscribes to `supabase.auth.onAuthStateChange` so SIGNED_IN /
 * SIGNED_OUT / TOKEN_REFRESHED ripple into all consumers without
 * prop drilling.
 *
 * This coexists with the mocked `authMethod` on AppContext — when
 * a real session lands, both systems agree the user is "signed in".
 */
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, getSessionCached } from "@/lib/supabase";

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

export function useSupabaseSession(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true });

  useEffect(() => {
    let cancelled = false;

    // Initial read — uses the cached getter to avoid racing other
    // concurrent auth reads on mount.
    (async () => {
      try {
        const { data } = await getSessionCached();
        if (cancelled) return;
        setState({
          user: data.session?.user ?? null,
          session: data.session ?? null,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ user: null, session: null, loading: false });
      }
    })();

    // Listen for future auth changes (sign-in, sign-out, token
    // refresh, etc.) — the Supabase client emits these as the
    // session state machine advances.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState({
        user: session?.user ?? null,
        session: session ?? null,
        loading: false,
      });
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Heartbeat: bump profiles.last_seen_at whenever a real session
  // exists. Drives the "recently active" tier in Discover AND the
  // green presence dots on avatars across the app.
  //
  // Pings on:
  //   1. mount (initial)
  //   2. every 5 minutes while the tab is open
  //   3. visibility change → "visible" (user came back to the tab)
  //   4. window "focus" (covers cases where visibilitychange fires
  //      late on some browsers)
  //
  // We coalesce rapid pings into a 30-second cooldown so a quickly-
  // tabbing user doesn't hammer the RPC. The 5-min cap on
  // useEffect interval still covers the long-idle case.
  useEffect(() => {
    if (!state.user) return;
    let cancelled = false;
    let lastPingAt = 0;
    const COOLDOWN_MS = 30_000;
    const ping = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastPingAt < COOLDOWN_MS) return;
      lastPingAt = now;
      void supabase.rpc("touch_last_seen");
    };
    ping();
    const id = setInterval(ping, 5 * 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", ping);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", ping);
    };
  }, [state.user]);

  return state;
}

/**
 * Sign out everywhere. Called from Profile → Sign out button.
 *
 * Three responsibilities:
 *   1. Tell Supabase to invalidate the session ON ALL DEVICES (scope:
 *      "global"). Default scope is "local" which only clears the
 *      current tab's tokens — confusing for users who signed in on
 *      phone + laptop and expect "sign out" to mean "log out from
 *      everywhere."
 *
 *   2. Clear EVERY `bu:` prefixed localStorage entry, not just a
 *      hand-curated list. The previous version typed "bu:onb" but
 *      the actual key is "bu:onboarded" — so the onboarding-complete
 *      flag survived sign-out. Iterating + prefix-filter catches
 *      every current key AND any future ones we add.
 *
 *   3. Force a full page reload to "/". The auth listener would
 *      propagate the state change anyway, but a hard reload
 *      guarantees:
 *        - All React state (drafts, chat, ephemeral UI) is nuked
 *        - Realtime subscriptions tear down cleanly
 *        - The user sees the sign-in form immediately on landing
 *      Avoids subtle half-signed-out states.
 *
 * Errors anywhere don't block — sign-out is "do what you can."
 * Even if the Supabase call fails (network down), the local
 * cleanup + reload still puts the UI in a clean signed-out state;
 * the server session gets cleaned up by token expiry later.
 */
export async function signOutEverywhere() {
  // 1. Server-side sign-out, global scope.
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch { /* network / already-signed-out — proceed */ }

  // 2. Wipe every bu:-prefixed localStorage entry. Snapshot keys
  // first so removeItem() doesn't shift indexes mid-loop.
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("bu:")) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* localStorage unavailable — proceed */ }

  // 3. Hard reload to home. Every realtime channel, every useState,
  // every cached query gets a fresh slate.
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}
