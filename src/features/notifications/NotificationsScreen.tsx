/**
 * NotificationsScreen — real notifications + mark-as-read.
 *
 * Loads from Supabase via useRealNotifications and renders the
 * inbox grouped into Unread / Earlier. Tapping a notification
 * marks it read; "Mark all read" clears the unread count.
 *
 * Realtime is wired via the hook — new INSERTs land instantly.
 *
 * Stub fallback runs only when not signed in, so the design still
 * demos for guest viewers.
 */
import { TopBar } from "@/components/shell/TopBar";
import { Avatar } from "@/shared/Avatar";
import { useRealNotifications } from "./useRealNotifications";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import type { Notification as NotifRow } from "@/lib/supabase";

const STUB_NOTIFS: NotifRow[] = [
  { id: "stub-1", user_id: "guest", from_id: "u1", type: "match",   subject: "New match",   post_id: null, read: false, created_at: new Date().toISOString(),                         from_profile: { id: "u1", name: "Omar Hamdan", avatar_color: "#5B4BF5" } as NotifRow["from_profile"] },
  { id: "stub-2", user_id: "guest", from_id: "u2", type: "message", subject: "New message", post_id: null, read: false, created_at: new Date(Date.now() - 3600e3).toISOString(),       from_profile: { id: "u2", name: "Hanan Saleh", avatar_color: "#E27D60" } as NotifRow["from_profile"] },
  { id: "stub-3", user_id: "guest", from_id: "u3", type: "room",    subject: "Room starts soon", post_id: null, read: true,  created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), from_profile: { id: "u3", name: "Algorithms cram", avatar_color: "#7CE0B6" } as NotifRow["from_profile"] },
];

export function NotificationsScreen() {
  const { user } = useSupabaseSession();
  const live = useRealNotifications();

  // Authed: real DB. Signed-out: stubs so the design still renders.
  const items: NotifRow[] = user ? live.notifications : STUB_NOTIFS;
  const loading = user ? live.loading : false;
  const unreadCount = items.filter(n => !n.read).length;

  const unread  = items.filter(n => !n.read);
  const earlier = items.filter(n =>  n.read);

  return (
    <>
      <TopBar
        title="Notifications"
        onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()}
        rightActions={["search"]}
      />
      <div className="max-w-[760px] mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
        {unreadCount > 0 && user && (
          <div className="flex items-center justify-end">
            <button
              onClick={() => { void live.markAllRead(); }}
              className="text-xs text-accent font-semibold hover:underline"
            >
              Mark all read
            </button>
          </div>
        )}

        {loading ? (
          <div className="bu-card divide-y divide-line">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-surface-3 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 bg-surface-3 rounded" />
                  <div className="h-3 w-3/4 bg-surface-3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {unread.length > 0 && (
              <Section title="Unread" items={unread} onMarkRead={user ? live.markRead : undefined} />
            )}
            <Section title="Earlier" items={earlier} onMarkRead={user ? live.markRead : undefined} />
            {items.length === 0 && (
              <div className="bu-card p-10 text-center">
                <div className="serif text-2xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>All caught up.</div>
                <p className="text-ink-3 text-sm">New notifications show up here in realtime.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Section({
  title, items, onMarkRead,
}: {
  title: string;
  items: NotifRow[];
  onMarkRead?: (id: string) => Promise<void>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider text-ink-3 mb-3">{title}</h2>
      <ul className="bu-card divide-y divide-line">
        {items.map(n => (
          <li
            key={n.id}
            className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-surface-2 ${!n.read ? "bg-surface-1" : ""}`}
            onClick={() => { if (!n.read) void onMarkRead?.(n.id); }}
          >
            <Avatar
              profile={{
                name: n.from_profile?.name ?? "—",
                avatar_color: n.from_profile?.avatar_color ?? "#5B4BF5",
              }}
              size={40}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-1 truncate">
                {labelForType(n.type, n.from_profile?.name)}
              </div>
              <div className="text-sm text-ink-2 mt-0.5 line-clamp-2">{n.subject}</div>
              <div className="text-xs text-ink-3 mt-1">{relative(n.created_at)}</div>
            </div>
            {!n.read && <span className="h-2 w-2 rounded-full bg-accent mt-2 shrink-0" aria-label="Unread" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function labelForType(type: string, fromName?: string | null): string {
  switch (type) {
    case "match":   return fromName ? `${fromName} matched with you` : "New match";
    case "message": return fromName ? `${fromName} messaged you` : "New message";
    case "room":    return "Room update";
    case "system":  return "Bas Udrus";
    default:        return fromName ?? type;
  }
}

function relative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Date.now() - t;
  if (d < 60e3) return "just now";
  if (d < 3600e3) return `${Math.floor(d / 60e3)}m ago`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`;
  return `${Math.floor(d / 86400e3)}d ago`;
}
