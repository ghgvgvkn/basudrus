/**
 * useMessages — real-time DM messages between two users.
 * Port of useRealMessages from the web app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Message } from '@/lib/supabase';

export function useMessages(partnerId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) { setLoading(false); return; }
    setMyId(user.id);

    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),` +
        `and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`,
      )
      .order('created_at', { ascending: true })
      .limit(100);

    setMessages((data as Message[]) ?? []);
    setLoading(false);
  }, [partnerId]);

  const sendMessage = useCallback(async (text: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user || !text.trim()) return;

    await supabase.from('messages').insert({
      sender_id: user.id,
      receiver_id: partnerId,
      text: text.trim(),
      message_type: 'text',
    });
  }, [partnerId]);

  useEffect(() => {
    load();
    // Per-mount channel suffix so Strict Mode + Fast Refresh don't
    // re-attach `.on()` callbacks to an already-subscribed channel
    // (which throws "cannot add postgres_changes callbacks after subscribe()").
    const channelName = `messages-${partnerId}-${Math.random().toString(36).slice(2, 10)}`;
    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const msg = payload.new as Message;
        if (msg.sender_id === partnerId || msg.receiver_id === partnerId) {
          setMessages(prev => [...prev, msg]);
        }
      })
      .subscribe();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [load, partnerId]);

  return { messages, loading, myId, sendMessage };
}
