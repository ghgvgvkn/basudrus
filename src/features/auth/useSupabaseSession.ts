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

/** Sign out + clear local storage hints. Call from Profile → Sign out. */
export async function signOutEverywhere() {
  await supabase.auth.signOut();
  try {
    // Any redesign-specific localStorage entries the AppContext
    // set during mock sign-in — clear them so the UI resets to
    // the anonymous state without a hard refresh.
    [
      "bu:auth", "bu:sub", "bu:onb", "bu:personality",
      "bu:open-thread", "bu:open-thread-meta", "bu:bypass-auth",
    ].forEach(k => localStorage.removeItem(k));
  } catch { /* noop */ }
}
