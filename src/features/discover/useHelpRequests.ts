/**
 * useHelpRequests — read help_requests joined with poster profile.
 *
 * RLS on `help_requests` requires `authenticated` role for SELECT,
 * so anonymous viewers get zero rows. That's fine — we show an
 * empty state ("Sign in to see posts") instead of fake data.
 *
 * When the signed-in port ships, this hook will just start returning
 * real rows; no component change needed.
 *
 * Returns latest 20 posts, newest first.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/shared/supabase";

export interface HelpRequest {
  id: string;
  user_id: string;
  subject: string;      // course code / topic
  detail: string | null;
  meet_type: string | null;
  created_at: string;
  author?: {
    id: string;
    name: string | null;
    avatar_color: string | null;
    major: string | null;
    uni: string | null;
    year: string | null;
  };
}

/** Mock data shown only in pure demo mode (no Supabase env vars). */
const DEMO_POSTS: HelpRequest[] = [
  { id: "demo-1", user_id: "u1", subject: "CS 301", detail: "Stuck on recursive CTEs — anyone explain with examples?",
    meet_type: "either", created_at: new Date(Date.now() - 1000*60*30).toISOString(),
    author: { id: "u1", name: "Ahmed", avatar_color: "#5B4BF5", major: "Computer Science", uni: "PSUT", year: "3" } },
  { id: "demo-2", user_id: "u2", subject: "MATH 301", detail: "Need help with triple integrals before Friday.",
    meet_type: "online", created_at: new Date(Date.now() - 1000*60*90).toISOString(),
    author: { id: "u2", name: "Leila", avatar_color: "#E27D60", major: "Mathematics", uni: "JU", year: "2" } },
  { id: "demo-3", user_id: "u3", subject: "BIO 201", detail: "Study group for the molecular biology midterm next week?",
    meet_type: "in_person", created_at: new Date(Date.now() - 1000*60*60*4).toISOString(),
    author: { id: "u3", name: "Nadia", avatar_color: "#7CE0B6", major: "Biology", uni: "JU", year: "2" } },
];

export function useHelpRequests() {
  const [posts, setPosts] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"blocked" | "offline" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        if (!cancelled) { setPosts(DEMO_POSTS); setLoading(false); }
        return;
      }
      try {
        // Join pattern: `author:profiles!help_requests_user_id_fkey(…)`
        // mirrors how the live repo's useDiscover does it. If the FK
        // name differs we retry with the plain `profiles` inner join.
        // FK constraint name in prod is `fk_help_requests_user`,
        // not the default column-derived alias.
        const { data, error: err } = await supabase
          .from("help_requests")
          .select(`
            id, user_id, subject, detail, meet_type, created_at,
            author:profiles!fk_help_requests_user(id, name, avatar_color, major, uni, year)
          `)
          .order("created_at", { ascending: false })
          .limit(20);

        if (cancelled) return;
        if (err) {
          // RLS block returns empty data (no error) for SELECT — so
          // any thrown error here is schema or network. Differentiate
          // offline (null data, no error) from blocked (null from RLS).
          setError("offline");
          setLoading(false);
          return;
        }
        // RLS + no auth yields `[]`, not an error. Treat empty as
        // "blocked" hint so the UI can show "sign in to see posts".
        if (!data || data.length === 0) {
          setError("blocked");
          setPosts([]);
        } else {
          setPosts(data as unknown as HelpRequest[]);
        }
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError("offline");
        setPosts([]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { posts, loading, error };
}
