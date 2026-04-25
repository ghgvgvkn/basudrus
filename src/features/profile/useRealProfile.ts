/**
 * useRealProfile — load + upsert the signed-in user's `profiles` row.
 *
 * Powers:
 *   - the AppContext profile fields once signed in
 *   - the Profile screen edit form
 *   - onboarding finalize (writes uni/major/year to the row)
 *
 * On first sign-in, an `auth.users` row exists but the matching
 * `profiles` row may not. We seed a minimal one with the email +
 * a generated avatar color so the user never sees an empty card.
 *
 * RLS:
 *   - SELECT: profiles_select_authenticated (any authed user)
 *   - INSERT: profiles_insert_own (id = auth.uid())
 *   - UPDATE: profiles_update_own (id = auth.uid())
 */
import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile as SupaProfile } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

const AVATAR_COLORS = [
  "#5B4BF5", "#8A5CF7", "#E27D60", "#7CE0B6",
  "#F5C945", "#0E8A6B", "#C23F6C", "#3BC79E",
];

function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export interface UseRealProfileState {
  profile: SupaProfile | null;
  loading: boolean;
  error: string | null;
  /** Patch any subset of editable fields. Returns the new row. */
  update: (patch: Partial<Pick<SupaProfile, "name" | "bio" | "uni" | "major" | "year" | "course" | "subjects" | "meet_type" | "avatar_color" | "photo_url" | "photo_mode">>) => Promise<SupaProfile | null>;
  /** Re-fetch from DB. */
  reload: () => Promise<void>;
}

export function useRealProfile(): UseRealProfileState {
  const { user, loading: authLoading } = useSupabaseSession();
  const [profile, setProfile] = useState<SupaProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user || !supabase) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Try to fetch the existing row first.
      const { data: existing, error: selErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing) {
        setProfile(existing as SupaProfile);
      } else {
        // Brand new user — seed the minimum so the rest of the app
        // has something to render. The profile_insert_own RLS rule
        // is satisfied because id = auth.uid().
        //
        // We DO write email into the profiles row even though it's
        // duplicated from auth.users — the /api/notify/message edge
        // function uses the service-role to read profiles.email when
        // emailing the receiver, and that's the only way to deliver
        // notifications to brand-new users. Cross-user privacy is
        // protected by the column-level revoke on profiles.email
        // (GRANTed to authenticated EXCEPT email), so other users
        // can't read this. Service role bypasses the GRANT for the
        // legitimate notification path.
        const seed: Partial<SupaProfile> = {
          id: user.id,
          email: user.email ?? "",
          name: (user.email ?? "").split("@")[0] || "Student",
          avatar_color: pickColor(user.id),
          photo_mode: "initials",
          photo_url: null,
          uni: "",
          major: "",
          year: "",
          course: "",
          meet_type: "either",
          bio: "",
          avatar_emoji: "",
          streak: 0,
          xp: 0,
          badges: [],
          online: true,
          sessions: 0,
          rating: 0,
          subjects: [],
        };
        const { data: inserted, error: insErr } = await supabase
          .from("profiles")
          .insert(seed)
          .select()
          .single();
        if (insErr) throw insErr;
        setProfile(inserted as SupaProfile);
      }
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load profile");
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  // Realtime: cross-tab + cross-device sync. If the user updates
  // their profile on phone, this hook on desktop picks it up.
  // Filtered to the viewer's own row so we don't react to other
  // users' profile changes (those are handled by useMatchScores).
  useEffect(() => {
    if (!supabase || !user) return;
    let channel: RealtimeChannel | null = null;
    const channelName = `profile-self-${user.id}-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const refresh = () => { void reload(); };
    channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, reload]);

  const update: UseRealProfileState["update"] = useCallback(async (patch) => {
    if (!user || !supabase) return null;
    try {
      const { data, error: err } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select()
        .single();
      if (err) throw err;
      const next = data as SupaProfile;
      setProfile(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return null;
    }
  }, [user]);

  return { profile, loading: loading || authLoading, error, update, reload };
}
