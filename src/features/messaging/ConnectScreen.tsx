/**
 * ConnectScreen — messaging with voice + attachments.
 *
 * Two views in one: thread list + active chat. Desktop shows both
 * side-by-side (list 320px, chat fills). Mobile shows list by
 * default; tapping a thread pushes the chat view (state-based, no
 * router).
 *
 * Composer actions (left→right):
 *   [+ attach]  [     text input     ]  [🎤 hold to record] OR [↑ send]
 *
 * Voice UX:
 *   - Hold the mic button → starts recording. A live waveform grows
 *     from left, with an elapsed-time chip. Pointer-up within the
 *     button area = send. Swipe left beyond the cancel threshold
 *     (60px) = cancel, bubble slides off. This mirrors the behaviour
 *     in the live production ConnectScreen we're porting from.
 *   - Mic permission is requested on first hold. If denied, a toast
 *     explains how to re-enable; the control falls back to a no-op.
 *   - When "released" (demo), we generate a fake waveform array and
 *     an estimated duration, then render a VoiceBubble with tap-to-
 *     play controls (the bundle uses a simulated playhead — the live
 *     port swaps in real <audio> element state).
 *
 * Data: stubbed. Slice 3 wires useMessages() + useRealtime() from
 * the legacy repo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Phone, Paperclip, Mic, Play, Pause, FileText,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { TopBar } from "@/components/shell/TopBar";
import { Avatar } from "@/shared/Avatar";
import { supabase } from "@/lib/supabase";
import type { GroupRoom, Profile } from "@/lib/supabase";
import { useRealConnections } from "./useRealConnections";
import { useRealMessages } from "./useRealMessages";
import { useRealRoomMessages } from "./useRealRoomMessages";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { useMatchScores } from "@/features/match/useMatchScores";
import { MatchBadge } from "@/features/match/MatchBadge";

interface Thread {
  id: string;
  /** "dm" = 1:1 chat; "room" = auto-created group chat for a study room. */
  kind: "dm" | "room";
  /** For "dm" threads. last_seen_at lets the avatar render a presence dot. */
  partner?: { id: string; name: string; avatar_color: string; last_seen_at?: string | null; photo_mode?: string; photo_url?: string | null };
  /** For "room" threads: group metadata. */
  room?: {
    id: string;                               // matches RoomStub.id
    name: string;
    subject: string;
    members: { id: string; name: string; color: string }[];
  };
  last: string;
  at: string;
  unread: number;
}

type Msg =
  | { id: string; mine: boolean; kind: "text"; body: string }
  /** Voice — `src` is the public chat-files URL when sent. The
   *  optional `waveform` is for the offline/local-only fallback. */
  | { id: string; mine: boolean; kind: "voice"; durationMs: number; src?: string; waveform?: number[] }
  | { id: string; mine: boolean; kind: "file"; filename: string };

// THREADS array (Algorithms finals cram, Omar Hamdan, Hanan Saleh,
// Yusuf Abadi, Leila Nasser) DELETED. It used to render for users
// without a real session — but the gate now forces real auth, so
// nobody hits the no-user path. Brand-new accounts with zero
// connections see the proper "No conversations yet" empty state
// instead of fake stub messages.

/** Member preview for room threads (used by RoomThreadIcon). Caps
 *  to ~6 names so the realtime fetch stays cheap. */
type RoomWithMembers = GroupRoom & {
  host?: Profile;
  members?: { id: string; name: string; avatar_color: string }[];
};

export function ConnectScreen() {
  const { user } = useSupabaseSession();
  const { connections, loading: connLoading } = useRealConnections();
  // Match scoring — exposed via the shared hook so ThreadList can
  // render a MatchBadge next to each DM partner. scoreFor returns
  // null for guests / self / candidates with no profile, in which
  // case the badge omits cleanly.
  const { scoreFor } = useMatchScores();
  // Map partner_id → full Profile so the thread row can look up
  // the score for any DM thread without re-fetching. Build once
  // per connection update.
  const partnerById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const c of connections) if (c.partner) m.set(c.partner_id, c.partner);
    return m;
  }, [connections]);
  const getMatchScore = (partnerId: string | undefined): number | null => {
    if (!partnerId) return null;
    const p = partnerById.get(partnerId);
    if (!p) return null;
    return scoreFor(p)?.score ?? null;
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  // Ad-hoc DM threads — created when Home/Discover sends the user
  // in with "Say hi" on a profile they haven't DM'd yet.
  const [adHoc, setAdHoc] = useState<Thread | null>(null);
  // Rooms the current user can chat in (host OR member). Loaded
  // separately from RoomsScreen's own fetch so this screen can stand
  // alone — the cost is one extra query per Connect open.
  const [userRooms, setUserRooms] = useState<RoomWithMembers[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user || !supabase) {
      setUserRooms([]);
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    (async () => {
      try {
        // Pull rooms the user is a member of. The host doesn't have a
        // self-row in group_members, so we union with rooms they host.
        const [memberQ, hostQ] = await Promise.all([
          supabase!.from("group_members").select("group_id").eq("user_id", user.id),
          supabase!.from("group_rooms").select("id").eq("host_id", user.id),
        ]);
        if (cancelled) return;
        const ids = new Set<string>();
        for (const r of (memberQ.data ?? []) as { group_id: string }[]) ids.add(r.group_id);
        for (const r of (hostQ.data   ?? []) as { id: string }[])       ids.add(r.id);
        if (ids.size === 0) {
          if (!cancelled) { setUserRooms([]); setRoomsLoading(false); }
          return;
        }
        // Fetch the rooms + first ~6 members for the avatar stack.
        const { data: rooms } = await supabase!
          .from("group_rooms")
          .select(`*, host:profiles!fk_group_rooms_host(id, name, avatar_color, photo_mode, photo_url)`)
          .in("id", Array.from(ids))
          .order("created_at", { ascending: false });
        if (cancelled) return;
        // Pull a tiny preview of members (up to 6 per room) for the
        // overlapping avatar stack in the thread list. Cheap enough
        // for typical room sizes (<= dozens of members).
        const { data: members } = await supabase!
          .from("group_members")
          .select(`group_id, user:profiles!fk_group_members_user(id, name, avatar_color)`)
          .in("group_id", Array.from(ids));
        if (cancelled) return;
        // Supabase types `user` as an array on a FK join even though
        // the FK is single-valued — normalize to the first row before
        // pushing into the per-room list.
        const membersByRoom = new Map<string, { id: string; name: string; avatar_color: string }[]>();
        type MemberJoinRow = {
          group_id: string;
          user: { id: string; name: string; avatar_color: string } | { id: string; name: string; avatar_color: string }[] | null;
        };
        for (const row of (members ?? []) as unknown as MemberJoinRow[]) {
          const u = Array.isArray(row.user) ? row.user[0] : row.user;
          if (!u) continue;
          const list = membersByRoom.get(row.group_id) ?? [];
          if (list.length < 6) list.push({ id: u.id, name: u.name, avatar_color: u.avatar_color });
          membersByRoom.set(row.group_id, list);
        }
        const enriched: RoomWithMembers[] = ((rooms ?? []) as RoomWithMembers[]).map((r) => ({
          ...r,
          members: membersByRoom.get(r.id) ?? [],
        }));
        if (!cancelled) { setUserRooms(enriched); setRoomsLoading(false); }
      } catch {
        if (!cancelled) { setUserRooms([]); setRoomsLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Build the thread list from real DMs (connections) + real rooms
  // (group_rooms / group_members the user belongs to). The gate
  // guarantees `user` is non-null at this point — if it ever isn't
  // (race during sign-out), an empty list is the correct render.
  const liveThreads: Thread[] = useMemo(() => {
    if (!user) return [];
    const dmThreads: Thread[] = connections.map<Thread>((c) => ({
      id: `dm:${c.partner_id}`,
      kind: "dm",
      partner: {
        id: c.partner_id,
        name: c.partner?.name ?? "Someone",
        avatar_color: c.partner?.avatar_color ?? "#5B4BF5",
        last_seen_at: c.partner?.last_seen_at ?? null,
        photo_mode: c.partner?.photo_mode,
        photo_url: c.partner?.photo_url,
      },
      // Message preview + timestamp will come from useRealMessages
      // in the next pass. Placeholder is honest about that.
      last: "(tap to open chat)",
      at: "",
      unread: 0,
    }));
    const roomThreads: Thread[] = userRooms.map<Thread>((r) => ({
      id: `room:${r.id}`,
      kind: "room",
      room: {
        id: r.id,
        // group_rooms doesn't store a "name" — the subject IS the
        // headline (e.g. "CS301"). Use that as the thread title and
        // tag it with the date for at-a-glance context.
        name: r.subject || "Study room",
        subject: r.subject || "",
        members: (r.members ?? []).map((m) => ({ id: m.id, name: m.name, color: m.avatar_color })),
      },
      last: r.date ? `${r.date} · ${r.time || ""}`.trim() : "Tap to open chat",
      at: "",
      unread: 0,
    }));
    return [...roomThreads, ...dmThreads];
  }, [user, connections, userRooms]);

  const threads = adHoc
    ? [adHoc, ...liveThreads.filter(t => t.id !== adHoc.id)]
    : liveThreads;
  const active = threads.find(t => t.id === activeId) ?? null;
  const showList = !active;

  // Tracks whether we've already consumed the bu:open-thread
  // localStorage hint. We want to run the consumer on first mount
  // AND, if connections are still loading, once more after they
  // arrive — but never twice.
  const consumedHintRef = useRef(false);

  // Rooms/Home → Connect hand-off. Upstream screens write
  // `bu:open-thread` (id) and optionally `bu:open-thread-meta`
  // (JSON profile) to localStorage, then navigate here. We read
  // both on mount, open the matching thread or synthesize one,
  // then clear the keys so later manual navigations don't reopen.
  useEffect(() => {
    if (consumedHintRef.current) return;
    // If connections are still loading and we haven't tried yet,
    // skip — we'll run again when liveThreads changes.
    if (connLoading) return;

    try {
      const hint = window.localStorage.getItem("bu:open-thread");
      const metaRaw = window.localStorage.getItem("bu:open-thread-meta");
      window.localStorage.removeItem("bu:open-thread");
      window.localStorage.removeItem("bu:open-thread-meta");
      consumedHintRef.current = true;

      if (!hint) return;

      // Existing seeded OR live-connection thread (rooms chat,
      // prior DM, or someone currently in the viewer's connections).
      if (liveThreads.some(t => t.id === hint)) {
        setActiveId(hint);
        return;
      }

      // DM to someone not in THREADS yet — build an ad-hoc thread
      // from the profile metadata the upstream screen handed us.
      if (metaRaw && hint.startsWith("dm:")) {
        const meta = JSON.parse(metaRaw) as { id: string; name: string; avatar_color: string };
        setAdHoc({
          id: hint,
          kind: "dm",
          partner: { id: meta.id, name: meta.name, avatar_color: meta.avatar_color },
          last: "(new conversation)",
          at: "now",
          unread: 0,
        });
        setActiveId(hint);
      }
    } catch { /* storage unavailable — ignore */ }
  }, [connLoading, liveThreads]);

  // Brand-new authed users have zero connections AND zero rooms —
  // show a clear empty state pointing them at Discover. We wait on
  // both loading flags so the screen doesn't flash empty before the
  // rooms query finishes.
  const hasNoThreads = !!user && !connLoading && !roomsLoading && threads.length === 0;
  const { setScreen } = useApp();

  return (
    <div className="min-h-[calc(100dvh-72px)] lg:min-h-dvh">
      {showList ? (
        <>
          <TopBar title="Messages" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
          <div className="lg:hidden">
            {hasNoThreads ? (
              <EmptyMessages onDiscover={() => setScreen("discover")} />
            ) : (
              <ThreadList threads={threads} onOpen={setActiveId} getMatchScore={getMatchScore} />
            )}
          </div>
        </>
      ) : (
        <div className="lg:hidden">
          <ChatView key={active.id} thread={active} onBack={() => setActiveId(null)} />
        </div>
      )}

      {/* Desktop: split view */}
      <div className="hidden lg:grid lg:grid-cols-[320px_1fr] lg:h-dvh">
        <aside className="border-e border-line bg-surface-1 overflow-y-auto">
          <div className="px-5 py-5 border-b border-line">
            <h1 className="serif text-2xl text-ink-1" style={{ fontStyle: "italic" }}>Messages</h1>
          </div>
          {hasNoThreads ? (
            <EmptyMessages onDiscover={() => setScreen("discover")} compact />
          ) : (
            <ThreadList threads={threads} onOpen={setActiveId} activeId={activeId ?? undefined} getMatchScore={getMatchScore} />
          )}
        </aside>
        <section className="flex flex-col">
          {active ? (
            <ChatView key={active.id} thread={active} onBack={() => setActiveId(null)} />
          ) : (
            <div className="flex-1 grid place-items-center text-center px-8">
              <div>
                <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>
                  {hasNoThreads ? "No conversations yet" : "Pick a conversation"}
                </div>
                <p className="text-ink-3 text-sm">
                  {hasNoThreads ? "Say hi to someone from Discover to start chatting." : "Or start one from Discover."}
                </p>
                {hasNoThreads && (
                  <button
                    onClick={() => setScreen("discover")}
                    className="mt-4 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold"
                  >Find people</button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyMessages({ onDiscover, compact }: { onDiscover: () => void; compact?: boolean }) {
  return (
    <div className={`text-center ${compact ? "p-6" : "px-6 py-16"}`}>
      <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>
        No conversations yet
      </div>
      <p className="text-ink-3 text-sm max-w-xs mx-auto">
        Say hi to someone from Discover and your DM will show up here.
      </p>
      <button
        onClick={onDiscover}
        className="mt-5 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold inline-flex items-center gap-1.5"
      >Find people →</button>
    </div>
  );
}

function ThreadList({ threads, onOpen, activeId, getMatchScore }: {
  threads: Thread[];
  onOpen: (id: string) => void;
  activeId?: string;
  /** Optional — when provided, DM rows show a MatchBadge with the
   *  viewer's match % for the partner. Rooms intentionally don't
   *  show one (no single counterparty to score against). */
  getMatchScore?: (partnerId: string | undefined) => number | null;
}) {
  return (
    <ul>
      {threads.map(t => {
        const active = t.id === activeId;
        const isRoom = t.kind === "room" && !!t.room;
        const score = !isRoom ? getMatchScore?.(t.partner?.id) ?? null : null;
        return (
          <li key={t.id}>
            <button
              onClick={() => onOpen(t.id)}
              className={`w-full text-start flex items-center gap-3 px-5 py-4 border-b border-line hover:bg-surface-2 transition-colors ${active ? "bg-surface-2" : ""}`}
            >
              {isRoom
                ? <RoomThreadIcon members={t.room!.members} />
                : <Avatar
                    profile={t.partner as Parameters<typeof Avatar>[0]["profile"]}
                    size={44}
                    lastSeenAt={t.partner!.last_seen_at}
                  />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isRoom && (
                    <span className="shrink-0 px-1.5 h-[18px] inline-flex items-center rounded bg-accent-soft text-accent-ink text-[10px] font-semibold">
                      {t.room!.subject}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-ink-1 truncate">
                    {isRoom ? t.room!.name : t.partner!.name}
                  </span>
                  {/* Match badge — DM rows only, hidden when score
                      can't be computed (guest, self, or no profile). */}
                  {score !== null && (
                    <MatchBadge score={score} size="xs" className="shrink-0" />
                  )}
                  <span className="text-xs text-ink-3 ms-auto shrink-0">{t.at}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs truncate ${t.unread ? "text-ink-1 font-medium" : "text-ink-3"}`}>{t.last}</span>
                  {t.unread > 0 && (
                    <span className="ms-auto h-5 min-w-5 px-1.5 rounded-full bg-accent text-white text-[10px] font-semibold grid place-items-center">{t.unread}</span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Overlapping avatar stack for group/room threads. Shows first 3
 *  members; a "+N" chip takes the 4th slot if there are more. */
function RoomThreadIcon({ members }: { members: { id: string; name: string; color: string }[] }) {
  const visible = members.slice(0, 3);
  const rest = Math.max(0, members.length - visible.length);
  return (
    <div className="relative h-11 w-11 shrink-0">
      {visible.map((m, i) => (
        <div
          key={m.id}
          className="absolute h-7 w-7 rounded-full grid place-items-center text-[10px] font-semibold text-white ring-2 ring-surface-1"
          style={{
            background: m.color,
            top:  i === 0 ? 0 : 14,
            left: i === 0 ? 14 : i === 1 ? 0 : 20,
          }}
        >
          {m.name[0]}
        </div>
      ))}
      {rest > 0 && (
        <div className="absolute bottom-0 end-0 h-5 px-1.5 rounded-full bg-ink-1 text-surface-0 text-[10px] font-semibold grid place-items-center ring-2 ring-surface-1">
          +{rest}
        </div>
      )}
    </div>
  );
}

function ChatView({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const { subscription, setScreen } = useApp();
  const { user } = useSupabaseSession();
  const { messages: allMessages, send: realSend, sendVoice: realSendVoice, load: loadMessages } = useRealMessages();
  // Group-chat hook — lives next to useRealMessages and only kicks in
  // when the active thread is a room. We always mount it (hooks rule)
  // and just route the load/send/render through whichever set
  // matches the thread.kind.
  const { messages: roomMessages, send: roomSend, load: roomLoad } = useRealRoomMessages();
  const [draft, setDraft] = useState("");
  // Voice/file messages are NOT yet persisted — they still live in
  // local state next to the real text thread until the storage port
  // lands. Visually they mix with real text messages.
  const [localExtras, setLocalExtras] = useState<Msg[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Defensive: a malformed thread (e.g. dm with missing partner OR
  // room with missing room) used to crash this view. Now we render
  // a friendly fallback instead — the user can hit Back and pick
  // another thread.
  const isRoom = thread.kind === "room" && !!thread.room;
  const isValidDm = thread.kind === "dm" && !!thread.partner?.id;
  if (!isRoom && !isValidDm) {
    return (
      <>
        <TopBar back="connect" title="Conversation" onOpenPalette={onBack} />
        <div className="flex-1 grid place-items-center text-center px-8 py-16">
          <div>
            <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>This chat couldn't load</div>
            <p className="text-ink-3 text-sm max-w-sm mx-auto">
              We're missing the other person's profile. They may have deleted their account.
            </p>
            <button
              onClick={onBack}
              className="mt-5 h-10 px-5 rounded-full bg-ink-1 text-surface-0 text-sm font-medium"
            >Back to messages</button>
          </div>
        </div>
      </>
    );
  }

  const partnerId = thread.partner?.id ?? null;
  const roomId = isRoom ? (thread.room?.id ?? null) : null;

  // Load the real history on open. DM threads load via partnerId,
  // room threads via roomId. Parent uses `key={active.id}` so this
  // re-mounts on every thread switch.
  useEffect(() => {
    if (partnerId && user) void loadMessages(partnerId);
  }, [partnerId, user, loadMessages]);
  useEffect(() => {
    if (roomId && user) void roomLoad(roomId);
  }, [roomId, user, roomLoad]);

  // Map the real rows into the UI's Msg shape. DMs come from
  // useRealMessages keyed by partnerId; rooms from
  // useRealRoomMessages keyed by roomId. Voice messages with a
  // file_url render as a real <audio> bubble; text messages render
  // as a chat bubble. (Room voice persistence lands separately.)
  const toMsg = (m: { id: string; sender_id: string; text: string; message_type?: string; file_url?: string | null }): Msg => {
    const mine = m.sender_id === user?.id;
    if (m.message_type === "voice" && m.file_url) {
      // text column carries durationMs (production convention).
      const durationMs = parseInt(m.text || "0", 10) || 0;
      return { id: m.id, mine, kind: "voice", durationMs, src: m.file_url };
    }
    return { id: m.id, mine, kind: "text", body: m.text };
  };
  const realMsgs: Msg[] = (() => {
    if (roomId && user) return (roomMessages[roomId] ?? []).map(toMsg);
    if (partnerId && user) return (allMessages[partnerId] ?? []).map(toMsg);
    return [];
  })();
  const msgs = [...realMsgs, ...localExtras];

  const sendText = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (roomId && user) {
      // Group chat — optimistic insert + realtime reconcile handled
      // inside useRealRoomMessages.
      void roomSend(roomId, text);
    } else if (partnerId && user) {
      // Real DM — same pattern via useRealMessages.
      void realSend(partnerId, text);
    } else {
      // Defensive — neither room nor DM context. Shouldn't happen
      // because the malformed-thread fallback bails earlier.
      setLocalExtras(prev => [...prev, { id: String(Date.now()), mine: true, kind: "text", body: text }]);
    }
  };

  // Voice send — uploads to chat-files and inserts a messages row.
  // For room threads we fall back to the local-only path until room
  // voice persistence lands (room_messages doesn't have file_url
  // wired through the hook yet). DM voices fully persist + replay
  // for both sender and receiver.
  const sendVoice = async (blob: Blob, durationMs: number) => {
    const id = String(Date.now());
    if (partnerId && user) {
      try {
        await realSendVoice(partnerId, blob, durationMs);
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[ChatView] voice send failed:", e);
        // Caller already rolled back the optimistic; show a local
        // failed-state bubble briefly so the user knows it didn't
        // ship (otherwise the UI looks like nothing happened).
        setLocalExtras(prev => [...prev, { id, mine: true, kind: "voice", durationMs, waveform: fakeWave(id, 42) }]);
      }
    } else {
      // Room voice — local-only until persisted path lands.
      setLocalExtras(prev => [...prev, { id, mine: true, kind: "voice", durationMs, waveform: fakeWave(id, 42) }]);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (subscription.tier !== "pro") {
      setScreen("subscription");
      e.target.value = "";
      return;
    }
    setLocalExtras(prev => [...prev, { id: String(Date.now()), mine: true, kind: "file", filename: f.name }]);
    e.target.value = "";
  };

  return (
    <>
      <TopBar
        back="connect"
        center={
          isRoom ? (
            <div className="flex items-center gap-2 min-w-0">
              <RoomThreadIcon members={thread.room!.members} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 h-[18px] inline-flex items-center rounded bg-accent-soft text-accent-ink text-[10px] font-semibold shrink-0">{thread.room!.subject}</span>
                  <span className="serif text-[16px] text-ink-1 truncate" style={{ fontStyle: "italic" }}>{thread.room!.name}</span>
                </div>
                <div className="text-[11px] text-ink-3">{thread.room!.members.length} members</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <Avatar
                profile={thread.partner as Parameters<typeof Avatar>[0]["profile"]}
                size={28}
                lastSeenAt={thread.partner!.last_seen_at}
              />
              <span className="serif text-[17px] text-ink-1 truncate" style={{ fontStyle: "italic" }}>{thread.partner!.name}</span>
            </div>
          )
        }
        rightActions={["search"]}
        right={
          // No one-to-one phone call in group threads.
          isRoom ? undefined : (
            <button type="button" aria-label="Call" className="h-10 w-10 grid place-items-center text-ink-2 rounded-full hover:bg-surface-2">
              <Phone className="h-[18px] w-[18px]" />
            </button>
          )
        }
        onOpenPalette={onBack /* noop */}
      />
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-5 space-y-2">
          {msgs.map((m) => <MsgBubble key={m.id} m={m} />)}
        </div>
        <Composer
          draft={draft}
          setDraft={setDraft}
          onSendText={sendText}
          onSendVoice={sendVoice}
          onPickFile={() => fileRef.current?.click()}
        />
        <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
      </div>
    </>
  );
}

function MsgBubble({ m }: { m: Msg }) {
  if (m.kind === "text") {
    return (
      <div className={m.mine ? "flex justify-end" : "flex"}>
        <div className={`max-w-[76%] px-4 py-2 rounded-2xl text-sm ${m.mine ? "bg-accent text-white" : "bg-surface-2 text-ink-1"}`}>
          {m.body}
        </div>
      </div>
    );
  }
  if (m.kind === "file") {
    return (
      <div className={m.mine ? "flex justify-end" : "flex"}>
        <div className={`max-w-[76%] px-4 py-3 rounded-2xl text-sm inline-flex items-center gap-3 ${m.mine ? "bg-accent text-white" : "bg-surface-2 text-ink-1"}`}>
          <FileText size={18} className="shrink-0 opacity-80" />
          <div>
            <div className="font-medium">{m.filename}</div>
            <div className={`text-xs ${m.mine ? "text-white/70" : "text-ink-3"}`}>Tap to open</div>
          </div>
        </div>
      </div>
    );
  }
  return <VoiceBubble m={m} />;
}

function VoiceBubble({ m }: { m: Extract<Msg, { kind: "voice" }> }) {
  // Two render paths:
  //   - Real DM voice (m.src is set) → use a hidden <audio> element
  //     so we get correct decoding, browser-native seeking, and
  //     accurate playback time. The waveform is decorative (seeded
  //     from the message id so the same message always gets the
  //     same shape — important for the receiver who didn't record).
  //   - Local-only voice (no src) → fall back to the simulated
  //     playhead the original demo used, so room voice messages
  //     still animate convincingly until persistence lands there.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 0..1
  // Set to true when the <audio> element fails to load m.src — usually
  // means the file was removed from Storage or the URL expired. We
  // swap the play button + waveform for a "Couldn't play" hint so the
  // user isn't stuck poking a dead button.
  const [loadError, setLoadError] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const baseRef = useRef<number>(0);
  const hasSrc = !!m.src;
  // Stable per-message waveform seed so the receiver sees the same
  // bars the sender saw. fakeWave is deterministic in the seed.
  const waveform = m.waveform ?? fakeWave(m.id, 42);

  useEffect(() => {
    if (hasSrc) return; // <audio>-driven path uses ontimeupdate
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = performance.now();
    const tick = (t: number) => {
      const elapsed = baseRef.current + (t - startRef.current);
      const next = Math.min(1, elapsed / m.durationMs);
      setPos(next);
      if (next >= 1) {
        setPlaying(false);
        baseRef.current = 0;
        setPos(0);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, m.durationMs, hasSrc]);

  const toggle = () => {
    if (hasSrc) {
      const el = audioRef.current;
      if (!el) return;
      if (el.paused) { void el.play(); }
      else { el.pause(); }
      return;
    }
    if (playing) {
      baseRef.current += performance.now() - startRef.current;
    }
    setPlaying((p) => !p);
  };

  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (!el) return;
    const dur = el.duration > 0 && Number.isFinite(el.duration) ? el.duration : m.durationMs / 1000;
    setPos(dur > 0 ? Math.min(1, el.currentTime / dur) : 0);
  };
  const onPlay  = () => setPlaying(true);
  const onPause = () => setPlaying(false);
  const onEnded = () => { setPlaying(false); setPos(0); };

  const elapsedSec = hasSrc
    ? Math.round((audioRef.current?.currentTime ?? 0))
    : Math.round((m.durationMs * (playing ? pos : (baseRef.current / m.durationMs || 0))) / 1000);
  const totalSec = Math.round(m.durationMs / 1000);

  // Failed-to-load fallback — shown when the <audio> element fired
  // onError. Avoids the "tap play, nothing happens" dead-end UI when
  // a voice file is missing from Storage.
  if (hasSrc && loadError) {
    return (
      <div className={m.mine ? "flex justify-end" : "flex"}>
        <div className={`max-w-[76%] px-4 py-2 rounded-2xl inline-flex items-center gap-2 text-xs ${m.mine ? "bg-accent/40 text-white/80" : "bg-surface-2 text-ink-3"}`}>
          <span aria-hidden>🎤</span>
          <span>Couldn't load this voice note.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={m.mine ? "flex justify-end" : "flex"}>
      <div className={`max-w-[76%] pe-4 ps-2 py-2 rounded-2xl inline-flex items-center gap-3 ${m.mine ? "bg-accent text-white" : "bg-surface-2 text-ink-1"}`}>
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className={`h-9 w-9 rounded-full grid place-items-center ${m.mine ? "bg-white/20 text-white" : "bg-ink-1 text-surface-0"}`}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ms-0.5" />}
        </button>
        <Waveform
          bars={waveform}
          progress={playing ? pos : (hasSrc ? pos : (baseRef.current / m.durationMs || 0))}
          tone={m.mine ? "on-accent" : "default"}
        />
        <span className={`text-[11px] tabular-nums ${m.mine ? "text-white/70" : "text-ink-3"}`}>
          {fmt(elapsedSec)} / {fmt(totalSec)}
        </span>
        {hasSrc && (
          <audio
            ref={audioRef}
            src={m.src}
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            onError={() => setLoadError(true)}
          />
        )}
      </div>
    </div>
  );
}

function Waveform({ bars, progress, tone }: { bars: number[]; progress: number; tone: "default" | "on-accent" }) {
  const played = Math.round(bars.length * progress);
  return (
    <div className="flex items-center gap-[2px] h-6 w-[140px]">
      {bars.map((h, i) => {
        const active = i < played;
        const color = tone === "on-accent"
          ? (active ? "bg-white" : "bg-white/40")
          : (active ? "bg-ink-1" : "bg-ink-4");
        return (
          <span key={i} className={`w-[2px] rounded-full ${color}`} style={{ height: `${Math.max(3, h * 24)}px` }} />
        );
      })}
    </div>
  );
}

// ─────────── Composer + voice recorder ───────────

function Composer({
  draft, setDraft, onSendText, onSendVoice, onPickFile,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSendText: () => void;
  /** Real send — receives the recorded blob + measured duration. */
  onSendVoice: (blob: Blob, durationMs: number) => void;
  onPickFile: () => void;
}) {
  // Real MediaRecorder via the hook. recording === true between
  // start() and stop(). The hook handles cleanup, MIME picking, and
  // the 3-min hard cap on recording length.
  const recorder = useVoiceRecorder();
  const [cancelled, setCancelled] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const downXRef = useRef<number>(0);

  // Drive the elapsed-time chip while recording. Cleanup on unmount
  // releases the rAF subscription so we don't leak.
  useEffect(() => {
    if (!recorder.recording) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      setElapsed(performance.now() - startedAtRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [recorder.recording]);

  // Translate the hook's error states into a friendly chip-message
  // shown in place of the input until the user clicks elsewhere.
  useEffect(() => {
    if (recorder.error === "denied") {
      setPermError("Mic access denied. Enable it in your browser to send voice.");
    } else if (recorder.error === "unsupported") {
      setPermError("Voice recording isn't supported here.");
    } else if (recorder.error === "network") {
      setPermError("Recording failed. Try again.");
    }
    // Auto-clear after a few seconds so the message bar isn't stuck.
    if (recorder.error) {
      const t = setTimeout(() => setPermError(null), 4000);
      return () => clearTimeout(t);
    }
  }, [recorder.error]);

  const startRecord = async (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    downXRef.current = e.clientX;
    startedAtRef.current = performance.now();
    setElapsed(0);
    setCancelled(false);
    setPermError(null);
    await recorder.start();
  };
  const moveRecord = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!recorder.recording) return;
    const dx = e.clientX - downXRef.current;
    setCancelled(dx < -60); // swipe-left threshold
  };
  const endRecord = async () => {
    if (!recorder.recording) return;
    if (cancelled) {
      recorder.cancel();
      return;
    }
    const result = await recorder.stop();
    // Discard taps under 300ms — usually accidental touches.
    if (!result || result.durationMs < 300) return;
    onSendVoice(result.blob, result.durationMs);
  };

  const hasText = draft.trim().length > 0;

  if (recorder.recording) {
    return (
      <div
        className="border-t border-line p-3 flex items-center gap-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      >
        <div className={`flex-1 h-11 rounded-full flex items-center gap-3 px-4 ${cancelled ? "bg-rose-soft text-rose" : "bg-surface-2 text-ink-1"}`}>
          <span className={`h-2 w-2 rounded-full ${cancelled ? "bg-rose" : "bg-rose animate-pulse"}`} />
          <span className="text-sm tabular-nums">{fmt(Math.round(elapsed / 1000))}</span>
          <LiveWaveform seed={elapsed} />
          <span className="ms-auto text-xs text-ink-3">
            {cancelled ? "Release to cancel" : "← swipe to cancel"}
          </span>
        </div>
        {/* Mic button stays pressed — onPointerUp on document would be more robust;
            rendering it here lets the same button handle release. */}
        <button
          aria-label="Release to send"
          onPointerMove={moveRecord}
          onPointerUp={endRecord}
          onPointerCancel={endRecord}
          className="h-11 w-11 rounded-full bg-accent text-white grid place-items-center scale-110 shadow-[var(--shadow-ai)] transition-transform"
        >
          <Mic size={18} />
        </button>
      </div>
    );
  }

  // Mic permission/unsupported error — replaces the input briefly.
  if (permError) {
    return (
      <div className="border-t border-line p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="h-11 px-4 rounded-full bg-rose-soft text-rose flex items-center text-xs">
          {permError}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-line p-3 flex gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
      <button
        type="button"
        onClick={onPickFile}
        aria-label="Attach file"
        className="h-11 w-11 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2"
      >
        <Paperclip size={18} />
      </button>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onSendText(); }}
        placeholder="Message…"
        className="flex-1 h-11 px-4 rounded-full bg-surface-1 border border-line outline-none focus:border-accent text-sm text-ink-1"
      />
      {hasText ? (
        <button
          type="button" onClick={onSendText} aria-label="Send"
          className="h-11 w-11 rounded-full bg-ink-1 text-surface-0 grid place-items-center active:scale-95 transition-transform"
        ><Send className="h-4 w-4 rtl:-rotate-180" /></button>
      ) : (
        <button
          type="button"
          onPointerDown={startRecord}
          onPointerMove={moveRecord}
          onPointerUp={endRecord}
          onPointerCancel={endRecord}
          aria-label="Hold to record voice message"
          className="h-11 w-11 rounded-full bg-ink-1 text-surface-0 grid place-items-center active:scale-95 transition-transform"
        >
          <Mic size={18} />
        </button>
      )}
    </div>
  );
}

function LiveWaveform({ seed }: { seed: number }) {
  // Cheap animated "levels" driven by sin() — stand-in for real
  // analyser node output. Port: feed this from an AudioContext +
  // AnalyserNode on the MediaRecorder stream.
  const bars = 24;
  return (
    <div className="flex items-center gap-[2px] h-6">
      {Array.from({ length: bars }).map((_, i) => {
        const h = 4 + Math.abs(Math.sin(seed / 180 + i * 0.7)) * 18;
        return <span key={i} className="w-[2px] rounded-full bg-ink-1" style={{ height: `${h}px` }} />;
      })}
    </div>
  );
}

// ─────────── utils ───────────

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Deterministic bar heights 0..1 from a seed. */
function fakeWave(seed: string, n: number): number[] {
  const out: number[] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out.push(0.25 + ((h % 1000) / 1000) * 0.75);
  }
  return out;
}
