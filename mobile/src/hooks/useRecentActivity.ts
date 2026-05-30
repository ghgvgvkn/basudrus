/**
 * useRecentActivity — Home's "Recent activity" feed, real data only.
 *
 * Mirrors `src/features/home/useRecentActivity.ts` on the website 1:1
 * so the same three signals appear in the same order across devices:
 *   - new help_requests  → "X posted for help with CS 201"
 *   - new group_rooms    → "Y created a CS 301 study room"
 *   - new connections    → "Z said hi to W"
 *
 * Fetches the latest 8 of each in parallel, merges, sorts newest first,
 * caps at 12. RLS hides everything from anonymous viewers so the hook
 * returns an empty list in that case and the UI shows the "Sign in" copy.
 *
 * Web uses `fk_help_requests_user` and `fk_group_rooms_host` named
 * constraints. Mobile mirrors that — those constraints were added in
 * the same SQL migrations the web depends on.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export type ActivityActor = {
  id: string;
  name: string | null;
  avatar_color: string | null;
  photo_mode?: string | null;
  photo_url?: string | null;
  avatar_emoji?: string | null;
};

export type ActivityItem = {
  id: string;
  kind: 'help' | 'room' | 'connection';
  actor: ActivityActor | null;
  verb: string;
  target?: { id: string; name: string } | null;
  createdAt: string;
};

const FETCH_LIMIT = 8;
const VISIBLE_LIMIT = 12;

export function useRecentActivity(): { items: ActivityItem[]; loading: boolean } {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const helpReq = supabase
        .from('help_requests')
        .select(
          `id, subject, created_at,
           actor:profiles!fk_help_requests_user(id, name, avatar_color, photo_url, avatar_emoji)`
        )
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);

      const roomReq = supabase
        .from('group_rooms')
        .select(
          `id, subject, created_at,
           actor:profiles!fk_group_rooms_host(id, name, avatar_color, photo_url, avatar_emoji)`
        )
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);

      const connReq = supabase
        .from('connections')
        .select(
          `id, created_at,
           actor:profiles!connections_user_id_fkey(id, name, avatar_color, photo_url, avatar_emoji),
           target:profiles!connections_partner_id_fkey(id, name)`
        )
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);

      const [helpRes, roomRes, connRes] = await Promise.all([helpReq, roomReq, connReq]);
      if (cancelled) return;

      // The Supabase typescript codegen often returns joined rows as an
      // array even when it's truly 1-to-1, so we defensively unwrap.
      const pickOne = <T,>(v: T | T[] | null | undefined): T | null => {
        if (!v) return null;
        return Array.isArray(v) ? (v[0] ?? null) : v;
      };

      const list: ActivityItem[] = [];

      for (const row of (helpRes.data ?? []) as unknown as Array<{
        id: string; subject: string; created_at: string;
        actor: ActivityActor | ActivityActor[] | null;
      }>) {
        list.push({
          id: `help:${row.id}`,
          kind: 'help',
          actor: pickOne(row.actor),
          verb: `posted for help with ${row.subject}`,
          createdAt: row.created_at,
        });
      }

      for (const row of (roomRes.data ?? []) as unknown as Array<{
        id: string; subject: string; created_at: string;
        actor: ActivityActor | ActivityActor[] | null;
      }>) {
        list.push({
          id: `room:${row.id}`,
          kind: 'room',
          actor: pickOne(row.actor),
          verb: `created a ${row.subject} study room`,
          createdAt: row.created_at,
        });
      }

      for (const row of (connRes.data ?? []) as unknown as Array<{
        id: string; created_at: string;
        actor: ActivityActor | ActivityActor[] | null;
        target: { id: string; name: string } | { id: string; name: string }[] | null;
      }>) {
        const actor = pickOne(row.actor);
        const target = pickOne(row.target);
        if (!actor || !target?.name) continue;
        list.push({
          id: `conn:${row.id}`,
          kind: 'connection',
          actor,
          target,
          verb: `said hi to ${target.name}`,
          createdAt: row.created_at,
        });
      }

      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setItems(list.slice(0, VISIBLE_LIMIT));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return { items, loading };
}
