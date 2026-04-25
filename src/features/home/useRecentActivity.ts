/**
 * useRecentActivity — Home's "Recent activity" feed, real data only.
 *
 * Mixes the three signals that say something is happening on the
 * platform right now:
 *   - new help_requests  → "X posted for help with CS 201"
 *   - new group_rooms    → "Y created a CS 301 study room"
 *   - new connections    → "Z said hi to W"
 *
 * Fetches the latest 8 of each in parallel, then merges + sorts
 * by created_at desc. Caps at 12 items so Home stays compact.
 *
 * Anonymous viewers get an empty list (RLS hides everything from
 * unauthenticated readers), and the UI handles that gracefully.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

export interface ActivityItem {
  id: string;
  kind: "help" | "room" | "connection";
  /** Who did the thing. */
  actor: Pick<Profile, "id" | "name" | "avatar_color" | "photo_mode" | "photo_url"> | null;
  /** Sentence shown after the actor's name. */
  verb: string;
  /** Optional secondary actor (e.g. who said hi to whom). */
  target?: Pick<Profile, "id" | "name"> | null;
  createdAt: string;
}

const FETCH_LIMIT = 8;
const VISIBLE_LIMIT = 12;

export function useRecentActivity(): { items: ActivityItem[]; loading: boolean } {
  const { user, loading: authLoading } = useSupabaseSession();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !supabase) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const helpReq = supabase
        .from("help_requests")
        .select(`id, subject, created_at,
                 actor:profiles!fk_help_requests_user(id, name, avatar_color, photo_mode, photo_url)`)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      const roomReq = supabase
        .from("group_rooms")
        .select(`id, subject, created_at,
                 actor:profiles!fk_group_rooms_host(id, name, avatar_color, photo_mode, photo_url)`)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      // For connections we need both ends — show "X said hi to Y".
      const connReq = supabase
        .from("connections")
        .select(`id, created_at,
                 actor:profiles!connections_user_id_fkey(id, name, avatar_color, photo_mode, photo_url),
                 target:profiles!connections_partner_id_fkey(id, name)`)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      const [helpRes, roomRes, connRes] = await Promise.all([helpReq, roomReq, connReq]);
      if (cancelled) return;

      const list: ActivityItem[] = [];

      // help_requests
      for (const row of (helpRes.data ?? []) as unknown as Array<{
        id: string; subject: string; created_at: string;
        actor: ActivityItem["actor"];
      }>) {
        list.push({
          id: `help:${row.id}`,
          kind: "help",
          actor: row.actor,
          verb: `posted for help with ${row.subject}`,
          createdAt: row.created_at,
        });
      }

      // group_rooms
      for (const row of (roomRes.data ?? []) as unknown as Array<{
        id: string; subject: string; created_at: string;
        actor: ActivityItem["actor"];
      }>) {
        list.push({
          id: `room:${row.id}`,
          kind: "room",
          actor: row.actor,
          verb: `created a ${row.subject} study room`,
          createdAt: row.created_at,
        });
      }

      // connections — only show when actor + target both have names
      for (const row of (connRes.data ?? []) as unknown as Array<{
        id: string; created_at: string;
        actor: ActivityItem["actor"];
        target: { id: string; name: string } | null;
      }>) {
        if (!row.actor || !row.target?.name) continue;
        list.push({
          id: `conn:${row.id}`,
          kind: "connection",
          actor: row.actor,
          target: row.target,
          verb: `said hi to ${row.target.name}`,
          createdAt: row.created_at,
        });
      }

      // Newest first across all three sources.
      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setItems(list.slice(0, VISIBLE_LIMIT));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { items, loading };
}
