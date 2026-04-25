/**
 * RoomsScreen — real `group_rooms` from Supabase.
 *
 * List: all rooms visible to the signed-in user, grouped by time
 * proximity (today / this week / later), with a search bar that
 * filters by subject / location. Each room is a card with a big
 * subject chip + time + host + members preview.
 *
 * Detail: opens when a room card is tapped. Shows subject, time,
 * place, host, join/leave CTA, "Room chat" hand-off to Connect,
 * edit/delete for hosts (UI only — wiring is next turn).
 *
 * Data flows through useRealRooms which owns the list, joined-set,
 * create, and toggle-join. RLS requires authenticated for SELECT,
 * so signed-out viewers get a sign-in nudge.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, MessageSquare, Search, X } from "lucide-react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { useRealRooms, type RoomFeedItem } from "./useRealRooms";
import { useRoomMembers, type RoomMember } from "./useRoomMembers";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { useCourseSearch } from "@/features/discover/useCourseSearch";
import { usePhotoGuard } from "@/features/profile/usePhotoGuard";
import { useMatchScores } from "@/features/match/useMatchScores";
import { MatchBadge } from "@/features/match/MatchBadge";

/** Bucket a room by its `date` text. Dates in prod are free-text
 *  ("2026-04-28", "Mon Apr 28", etc.) so we parse defensively. */
function bucketFor(room: RoomFeedItem): "today" | "week" | "later" {
  const parsed = Date.parse(`${room.date} ${room.time || ""}`.trim());
  if (!Number.isFinite(parsed)) return "later";
  const now = Date.now();
  const MS_DAY = 86_400_000;
  if (parsed < now - MS_DAY) return "later";             // past
  if (parsed < now + MS_DAY) return "today";
  if (parsed < now + 7 * MS_DAY) return "week";
  return "later";
}

/** Shorten "2026-04-28 19:00" → "Apr 28 · 7:00pm". Defensive — if
 *  parsing fails we show the raw date/time the host typed. */
function whenText(date: string, time: string): string {
  const parsed = Date.parse(`${date} ${time || ""}`.trim());
  if (!Number.isFinite(parsed)) return [date, time].filter(Boolean).join(" · ");
  const d = new Date(parsed);
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const t   = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t}`;
}

export function RoomsScreen() {
  const { user } = useSupabaseSession();
  const { profile } = useApp();
  const { rooms, loading, error, toggleJoin, submitRoom } = useRealRooms();
  const { requirePhoto } = usePhotoGuard();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const startCreate = () => {
    requirePhoto(
      () => setCreating(true),
      "Please upload your profile photo first so members know whose room they're joining.",
    );
  };

  // ⚠️ All hooks MUST run before the early return.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(r =>
      (r.subject ?? "").toLowerCase().includes(q) ||
      (r.location ?? "").toLowerCase().includes(q) ||
      (r.host?.name ?? "").toLowerCase().includes(q),
    );
  }, [query, rooms]);

  const open = rooms.find(r => r.id === openId) ?? null;
  if (open) {
    return (
      <RoomDetail
        room={open}
        isHost={open.host_id === (user?.id ?? profile?.id)}
        onToggleJoin={() => toggleJoin(open.id)}
        onBack={() => setOpenId(null)}
      />
    );
  }

  const today = filtered.filter(r => bucketFor(r) === "today");
  const week  = filtered.filter(r => bucketFor(r) === "week");
  const later = filtered.filter(r => bucketFor(r) === "later");
  const hasResults = today.length + week.length + later.length > 0;

  return (
    <>
      <TopBar title="Rooms" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-6 lg:py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="serif text-3xl lg:text-4xl text-ink-1" style={{ fontStyle: "italic" }}>Rooms</h1>
          <button
            onClick={startCreate}
            disabled={!user}
            className="h-10 px-4 rounded-full bg-accent text-white text-sm font-medium inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> New room
          </button>
        </div>

        <div className="mb-6 relative">
          <Search className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by course (CS301), host, or place…"
            className="w-full h-12 ps-11 pe-10 rounded-full bg-surface-2 border border-line focus:border-accent focus:bg-surface-1 outline-none text-ink-1 placeholder:text-ink-3 text-sm transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute end-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full grid place-items-center text-ink-3 hover:bg-surface-3"
            ><X className="h-3.5 w-3.5" /></button>
          )}
        </div>

        {loading ? (
          <LoadingRoomsGrid />
        ) : error === "blocked" || (!user && rooms.length === 0) ? (
          <div className="bu-card p-10 text-center">
            <div className="serif text-2xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>Sign in to see rooms</div>
            <p className="text-ink-3 text-sm max-w-md mx-auto">
              Group study rooms are visible once you're signed in so we can surface the ones at your university.
            </p>
          </div>
        ) : !hasResults ? (
          <div className="bu-card p-10 text-center">
            <div className="serif text-xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>No rooms match "{query}"</div>
            <p className="text-ink-3 text-sm">Try a different course code, or create one yourself.</p>
          </div>
        ) : (
          <>
            <Section title="Today" rooms={today} onOpen={setOpenId} />
            <Section title="This week" rooms={week} onOpen={setOpenId} />
            <Section title="Later" rooms={later} onOpen={setOpenId} />
          </>
        )}
      </div>

      {creating && (
        <CreateRoomModal
          onClose={() => setCreating(false)}
          onSubmit={submitRoom}
        />
      )}
    </>
  );
}

function CreateRoomModal({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (p: {
    subject: string; date: string; time: string;
    type: "online" | "in_person"; spots: number;
    link?: string; location?: string;
  }) => Promise<{ ok: boolean; error?: string } | { ok: true; room: unknown }>;
}) {
  const [subject, setSubject] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [type, setType] = useState<"online" | "in_person">("online");
  const [spots, setSpots] = useState(4);
  const [link, setLink] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { results: courseMatches, loading: coursesLoading } = useCourseSearch(courseQuery);

  // Default date = today's ISO date so the field isn't empty on open.
  useEffect(() => {
    if (!date) {
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      setDate(iso);
    }
  }, [date]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = !!subject && !!date && !!time && spots >= 2 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await onSubmit({
        subject: subject.trim(),
        date, time,
        type,
        spots: Number(spots) || 4,
        link: type === "online" ? link.trim() : "",
        location: type === "in_person" ? location.trim() : "",
      });
      if ("ok" in result && result.ok) {
        onClose();
      } else {
        setErr(("error" in result && result.error) || "Couldn't create the room. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New study room"
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-ink-1/45 backdrop-blur-sm" aria-hidden />
      <div className="relative w-full max-w-[560px] max-h-[92dvh] overflow-y-auto bg-surface-1 rounded-[28px] border border-line shadow-xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="serif text-2xl text-ink-1" style={{ fontStyle: "italic" }}>New study room</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2"
          ><X className="h-4 w-4" /></button>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {/* Course / subject — searchable against uni_courses */}
          <div>
            <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Course or topic *</label>
            {subject ? (
              <div className="flex items-center gap-2 h-11 px-3 rounded-lg bg-accent-soft border border-accent/30">
                <span className="text-sm font-semibold text-accent-ink">{subject}</span>
                <button
                  onClick={() => { setSubject(""); setCourseQuery(""); }}
                  className="ms-auto h-7 w-7 rounded-full grid place-items-center text-accent-ink/70 hover:bg-white/40"
                ><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3 pointer-events-none" />
                  <input
                    autoFocus
                    value={courseQuery}
                    onChange={(e) => setCourseQuery(e.target.value)}
                    placeholder="CS 301, Calculus, Biology…"
                    className="w-full h-11 ps-10 pe-3 rounded-lg border border-line bg-surface-2 focus:border-accent focus:bg-surface-1 outline-none text-ink-1 placeholder:text-ink-3 text-sm"
                  />
                </div>
                {courseMatches.length > 0 && (
                  <ul className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-line divide-y divide-line">
                    {courseMatches.slice(0, 8).map(c => (
                      <li key={c.id}>
                        <button
                          onClick={() => setSubject(c.name)}
                          className="w-full text-start px-3 py-2 text-sm text-ink-1 hover:bg-surface-2"
                        >{c.name}</button>
                      </li>
                    ))}
                  </ul>
                )}
                {coursesLoading && courseMatches.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-3">Searching 36k courses…</p>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 focus:border-accent outline-none text-ink-1"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Time *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 focus:border-accent outline-none text-ink-1"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Where</label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setType("online")}
                className={`flex-1 h-10 rounded-full text-sm font-medium ${type === "online" ? "bg-ink-1 text-surface-0" : "bg-surface-2 border border-line text-ink-2"}`}
              >Online</button>
              <button
                onClick={() => setType("in_person")}
                className={`flex-1 h-10 rounded-full text-sm font-medium ${type === "in_person" ? "bg-ink-1 text-surface-0" : "bg-surface-2 border border-line text-ink-2"}`}
              >In person</button>
            </div>
            {type === "online" ? (
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Meeting link (optional)"
                className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 focus:border-accent outline-none text-ink-1 text-sm"
              />
            ) : (
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Library L3"
                className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 focus:border-accent outline-none text-ink-1 text-sm"
              />
            )}
          </div>

          <div>
            <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Spots</label>
            <input
              type="number"
              min={2}
              max={20}
              value={spots}
              onChange={(e) => setSpots(Math.max(2, Math.min(20, Number(e.target.value) || 4)))}
              className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 focus:border-accent outline-none text-ink-1"
            />
          </div>

          {err && (
            <p className="text-xs text-[#C23F6C]">{err}</p>
          )}
        </div>

        <div className="flex items-center gap-2 px-6 pb-5 pt-1 border-t border-line bg-surface-2/60">
          <button
            onClick={onClose}
            className="h-11 px-5 rounded-full text-sm font-medium text-ink-2 hover:bg-surface-3"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 h-11 rounded-full bg-accent text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent/90"
          >
            {busy ? "Creating…" : "Create room"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingRoomsGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bu-card p-5 animate-pulse">
          <div className="h-7 w-24 bg-surface-3 rounded-full mb-3" />
          <div className="h-6 w-3/4 bg-surface-3 rounded mb-3" />
          <div className="h-4 w-1/2 bg-surface-3 rounded" />
        </div>
      ))}
    </div>
  );
}

function Section({ title, rooms, onOpen }: { title: string; rooms: RoomFeedItem[]; onOpen: (id: string) => void }) {
  if (rooms.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-wider text-ink-3 mb-3">{title}</h2>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rooms.map(r => (
          <li key={r.id}>
            <RoomCard room={r} onOpen={() => onOpen(r.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Room list card — host + members visible WITHOUT clicking through.
 *  Member photos are loaded per room (lightweight one-shot query)
 *  so the user can see who's in before opening. */
function RoomCard({ room, onOpen }: { room: RoomFeedItem; onOpen: () => void }) {
  const { members } = useRoomMembers(room.id);
  const { scoreFor } = useMatchScores();
  // Show host first, then up to 3 other members. Stack is +N on
  // anything past 4 total to keep cards from getting crowded.
  const ordered: RoomMember[] = (() => {
    const out: RoomMember[] = [];
    const seen = new Set<string>();
    if (room.host) {
      const h: RoomMember = {
        id: room.host.id,
        name: room.host.name,
        avatar_color: room.host.avatar_color,
        photo_mode: room.host.photo_mode,
        photo_url: room.host.photo_url,
        major: room.host.major,
        year: room.host.year,
        uni: room.host.uni,
        subjects: room.host.subjects,
      };
      out.push(h);
      seen.add(h.id);
    }
    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  })();
  // Best match score across everyone in the room (host + members).
  // We display ONE badge per room — "this room has someone you'd
  // pair with at 92%" is more useful than spamming one badge per
  // member. The room itself is the unit, not the individual.
  const bestScore: number | null = (() => {
    let best: number | null = null;
    for (const m of ordered) {
      const r = scoreFor(m);
      if (r && (best === null || r.score > best)) best = r.score;
    }
    return best;
  })();
  const visible = ordered.slice(0, 4);
  const overflow = Math.max(0, ordered.length - visible.length);

  return (
    <button onClick={onOpen} className="w-full text-start bu-card p-5 hover:border-accent transition-colors">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="px-3 h-8 inline-flex items-center rounded-full bg-accent-soft text-accent-ink text-sm font-bold tracking-wide">
          {room.subject}
        </span>
        <span className="text-xs text-ink-3">{whenText(room.date, room.time)}</span>
        {/* Best match across the room's members — single chip rather
            than per-member to keep cards uncluttered. Shows up as
            soon as the viewer has taken the quiz; otherwise hidden. */}
        {bestScore !== null && (
          <span className="text-[10px] text-ink-3 ms-auto inline-flex items-center gap-1">
            best
            <MatchBadge score={bestScore} size="xs" />
          </span>
        )}
        {room.joined && (
          <span className={`${bestScore !== null ? "" : "ms-auto"} px-2 h-5 inline-flex items-center rounded-full bg-mint/15 text-mint text-[10px] font-semibold`}>Joined</span>
        )}
      </div>

      {/* Host row — photo + name visible up front */}
      <div className="flex items-center gap-3 mb-3">
        {room.host && (
          <MemberAvatar
            member={{
              id: room.host.id,
              name: room.host.name,
              avatar_color: room.host.avatar_color,
              photo_mode: room.host.photo_mode,
              photo_url: room.host.photo_url,
              major: room.host.major,
              year: room.host.year,
              uni: room.host.uni,
              subjects: room.host.subjects,
            }}
            size={40}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">Host</div>
          <div className="serif text-lg text-ink-1 leading-tight truncate" style={{ fontStyle: "italic" }}>
            {room.host?.name ?? "someone"}
          </div>
        </div>
      </div>

      {/* Member avatars row — see-who-is-in-without-clicking */}
      {ordered.length > 1 && (
        <div className="flex items-center gap-2 mb-3 pt-3 border-t border-line">
          <div className="flex -space-x-2 rtl:space-x-reverse">
            {visible.map(m => (
              <div key={m.id} className="ring-2 ring-surface-1 rounded-full">
                <MemberAvatar member={m} size={28} />
              </div>
            ))}
            {overflow > 0 && (
              <div
                className="h-7 w-7 rounded-full bg-ink-1 text-surface-0 text-[10px] font-semibold grid place-items-center ring-2 ring-surface-1"
                aria-label={`${overflow} more members`}
              >+{overflow}</div>
            )}
          </div>
          <span className="text-xs text-ink-3">{ordered.length} {ordered.length === 1 ? "member" : "members"}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span>{room.filled}/{room.spots} spots · {room.location || (room.type === "online" ? "Online" : "—")}</span>
      </div>
    </button>
  );
}

function RoomDetail({ room, isHost, onBack: _onBack, onToggleJoin }: {
  room: RoomFeedItem;
  isHost: boolean;
  onBack: () => void;
  onToggleJoin: () => void;
}) {
  const { setScreen } = useApp();
  const joined = room.joined || isHost;
  // Real members + host avatars from `group_members` joined to profiles.
  const { members } = useRoomMembers(room.id);
  // Show host first if present, then everyone else (deduped by id).
  const displayedMembers: RoomMember[] = (() => {
    const seen = new Set<string>();
    const out: RoomMember[] = [];
    if (room.host) {
      out.push({
        id: room.host.id,
        name: room.host.name,
        avatar_color: room.host.avatar_color,
        photo_mode: room.host.photo_mode,
        photo_url: room.host.photo_url,
        major: room.host.major,
        year: room.host.year,
        uni: room.host.uni,
        subjects: room.host.subjects,
      });
      seen.add(room.host.id);
    }
    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  })();

  const openRoomChat = () => {
    try { window.localStorage.setItem("bu:open-thread", `room:${room.id}`); } catch { /* noop */ }
    setScreen("connect");
  };

  return (
    <>
      <TopBar back="rooms" title="Room" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[720px] mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
        <header className="bu-card p-6">
          <div className="flex items-center gap-2 text-xs text-ink-3 mb-2">
            <span className="px-3 h-7 inline-flex items-center rounded-full bg-accent-soft text-accent-ink text-sm font-bold tracking-wide">{room.subject}</span>
            <span>·</span><span>Hosted by {room.host?.name ?? "someone"}</span>
          </div>
          <h1 className="serif text-3xl text-ink-1 mb-2" style={{ fontStyle: "italic" }}>
            {whenText(room.date, room.time)}
          </h1>
          <div className="text-ink-2 text-sm">
            {room.location || (room.type === "online" ? "Online (link shared with members)" : "—")}
          </div>
          <div className="mt-3 text-xs text-ink-3">
            {room.filled} of {room.spots} spots filled
          </div>
        </header>

        {/* Members — real photos and names from group_members. */}
        {displayedMembers.length > 0 && (
          <section className="bu-card p-5">
            <h2 className="text-xs text-ink-3 uppercase tracking-wider mb-3">Who's in</h2>
            <ul className="flex flex-wrap gap-3">
              {displayedMembers.map(m => (
                <li key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-surface-2 border border-line">
                  <MemberAvatar member={m} size={28} />
                  <span className="text-sm text-ink-1 max-w-[160px] truncate">
                    {m.name}{room.host?.id === m.id ? <span className="text-[10px] text-ink-3 ms-1">host</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {joined && (
          <button
            onClick={openRoomChat}
            className="w-full bu-card p-5 flex items-center gap-4 text-start hover:border-accent transition-colors"
          >
            <div className="h-11 w-11 rounded-full bg-accent-soft grid place-items-center shrink-0">
              <MessageSquare className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="serif text-lg text-ink-1" style={{ fontStyle: "italic" }}>Room chat</div>
              <div className="text-xs text-ink-3 mt-0.5">{room.filled} members · group messages</div>
            </div>
            <span className="text-ink-3" aria-hidden>→</span>
          </button>
        )}

        <div className="flex gap-2">
          <button
            onClick={onToggleJoin}
            className={`flex-1 h-12 rounded-full font-medium text-sm active:scale-95 transition-transform ${joined ? "bg-surface-2 text-ink-1 border border-line" : "bg-accent text-white"}`}
          >
            {joined ? "Leave" : (room.filled >= room.spots ? "Full" : "Join")}
          </button>
          {isHost && (
            <>
              <button className="h-12 w-12 rounded-full border border-line text-ink-2 grid place-items-center" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              <button className="h-12 w-12 rounded-full border border-line text-ink-2 grid place-items-center" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
            </>
          )}
        </div>

        <p className="text-[11px] text-ink-3 text-center">
          Joining a room auto-enrolls you in its group chat. Leaving removes you.
        </p>
      </div>
    </>
  );
}

function MemberAvatar({ member, size = 28 }: { member: RoomMember; size?: number }) {
  const hasPhoto = member.photo_mode === "photo" && !!member.photo_url;
  const initials = (member.name ?? "?")
    .split(/\s+/).slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return (
    <div
      className="rounded-full grid place-items-center text-[10px] font-semibold text-white shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: hasPhoto ? "transparent" : (member.avatar_color || "#5B4BF5") }}
    >
      {hasPhoto ? (
        <img src={member.photo_url ?? undefined} alt="" className="h-full w-full object-cover" />
      ) : initials}
    </div>
  );
}
