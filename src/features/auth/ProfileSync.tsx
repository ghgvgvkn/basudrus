/**
 * ProfileSync — bridges the real Supabase profile into AppContext.
 *
 * AppContext.profile was originally seeded with the DEMO_PROFILE
 * (Layla Rahman, King Fahd University) for the design preview. Once
 * a user actually signs in, every screen except those that already
 * call useRealProfile() directly was still reading the seeded demo.
 * That's why the sidebar, Home greeting and Profile screen kept
 * showing "Layla Rahman" alongside real data on Discover.
 *
 * This component sits inside AppProvider's children tree, watches
 * the real profile loaded by `useRealProfile`, and pushes a
 * shared/types Profile shape into AppContext whenever the real one
 * changes. On sign-out the seeded demo profile takes over again,
 * so the marketing/preview routes still look right.
 *
 * It renders nothing.
 */
import { useEffect } from "react";
import { useApp, DEMO_PROFILE } from "@/context/AppContext";
import { useSupabaseSession } from "./useSupabaseSession";
import { useRealProfile } from "@/features/profile/useRealProfile";
import type { Profile as UIProfile } from "@/shared/types";
import type { Profile as DBProfile } from "@/lib/supabase";

/** Map a Supabase `profiles` row into the lightweight UI Profile
 *  shape AppContext expects. Year is stored as a string in the DB
 *  ("1".."7" or ""), but the UI type wants `number | null` — parse
 *  defensively. Subjects double as `interests` for the old card UI
 *  that hasn't been ported to subjects yet. */
function toUIProfile(db: DBProfile, sessionEmail: string | null = null): UIProfile {
  const yearNum = db.year ? Number(db.year) : NaN;
  return {
    id: db.id,
    name: db.name || "Student",
    uni: db.uni || null,
    major: db.major || null,
    year: Number.isFinite(yearNum) ? yearNum : null,
    bio: db.bio || null,
    interests: Array.isArray(db.subjects) && db.subjects.length ? db.subjects : null,
    avatar_color: db.avatar_color || null,
    photo_mode: db.photo_mode === "photo" ? "photo" : "avatar",
    photo_url: db.photo_url ?? null,
    points: typeof db.xp === "number" ? db.xp : 0,
    streak: typeof db.streak === "number" ? db.streak : 0,
    // Email comes from auth.users (sessionEmail) — profiles.email is
    // column-level revoked from the authenticated role for privacy
    // and is no longer populated for new users.
    email: sessionEmail ?? undefined,
  };
}

export function ProfileSync() {
  const { user } = useSupabaseSession();
  const { profile: dbProfile } = useRealProfile();
  const { setProfile } = useApp();

  useEffect(() => {
    if (user && dbProfile) {
      setProfile(toUIProfile(dbProfile, user.email ?? null));
    } else if (!user) {
      // Signed out: hand the seeded demo back so unauthenticated
      // marketing surfaces still render Layla.
      setProfile(DEMO_PROFILE);
    }
    // dbProfile is the only meaningful trigger — re-running on every
    // setProfile reference change would loop because setProfile is
    // a fresh function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dbProfile]);

  return null;
}
