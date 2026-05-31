/**
 * useConversations — real connection threads from Supabase.
 * Port of useRealConnections from the web app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/supabase';

export interface ConversationRow {
  partner_id: string;
  partner: Profile;
  last_message_at: string | null;
  last_message_preview: string;
  last_message_from_me: boolean;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) { setConversations([]); setLoading(false); return; }

      const { data, error: err } = await supabase
        .from('connections')
        .select(`
          partner_id,
          partner:profiles!connections_partner_id_fkey(*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (err) throw err;

      // Fetch last message for each conversation. Supabase's foreign
      // table join returns the related row as an array by default — we
      // unwrap to the first element below since `connections.partner_id`
      // is single-valued.
      const rows: ConversationRow[] = await Promise.all(
        ((data ?? []) as unknown as { partner_id: string; partner: Profile | Profile[] }[]).map(async row => {
          const partner = Array.isArray(row.partner) ? row.partner[0] : row.partner;
          const { data: msgs } = await supabase
            .from('messages')
            .select('text, sender_id, created_at')
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${row.partner_id}),and(sender_id.eq.${row.partner_id},receiver_id.eq.${user.id})`)
            .order('created_at', { ascending: false })
            .limit(1);

          const last = msgs?.[0];
          return {
            partner_id: row.partner_id,
            partner,
            last_message_at: last?.created_at ?? null,
            last_message_preview: last?.text ?? '',
            last_message_from_me: last?.sender_id === user.id,
          };
        }),
      );

      // Sort by most recent message
      rows.sort((a, b) => {
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      setConversations(rows);
    } catch (e) {
      setError((e as Error).message ?? 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Per-mount channel name — see useRooms for why a fixed name blows
    // up under React Strict Mode / Fast Refresh.
    const channelName = `conversations-${Math.random().toString(36).slice(2, 10)}`;
    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, () => load())
      .subscribe();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [load]);

  return { conversations, loading, error, refresh: load };
}
