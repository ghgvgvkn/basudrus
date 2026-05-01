/**
 * Sidebar — desktop-only left rail (hidden below lg).
 *
 * Contents, top to bottom:
 *   1. Logo header (click → Home)
 *   2. Primary nav items (Home, Discover, AI, Messages, Rooms)
 *   3. Secondary nav (Notifications, Profile, Settings)
 *   4. "Post for help" CTA (pinned bottom)
 *   5. User card (avatar + name + online dot)
 *
 * Nav routing is done by calling AppContext.setScreen. No react-router
 * — the app uses screen strings as the single source of truth.
 *
 * RTL: the outer Shell already flips layout via `dir`. All positional
 * classes here use logical properties (start/end/ps/pe/ms/me) so
 * direction mirroring is automatic.
 */
import type { ReactNode } from "react";
import {
  Home,
  Compass,
  Sparkles,
  MessageSquare,
  Users,
  Bell,
  User,
  Settings as SettingsIcon,
  Plus,
  Search,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { Logo } from "@/shared/Logo";
import { useRealNotifications } from "@/features/notifications/useRealNotifications";

interface NavItem {
  id: string;
  icon: ReactNode;
  labelKey: string;
  badge?: number | null;
}

export function Sidebar({
  onOpenPalette,
  onNewPost,
}: {
  onOpenPalette: () => void;
  onNewPost?: () => void;
}) {
  const { screen, setScreen, profile, isOnline } = useApp();
  const { t } = useLocale();
  // Real unread notifications count drives the Notifications badge.
  // The hook subscribes to realtime INSERTs so the badge updates the
  // moment a new notification lands. When zero, NavButton hides the
  // pill entirely. (Messages unread is tracked client-side per-thread
  // and isn't aggregated to a sidebar count yet — port lands separately.)
  const { unreadCount: notifUnread } = useRealNotifications();

  const primary: NavItem[] = [
    { id: "home",     icon: <Home className="h-[18px] w-[18px]" />,     labelKey: "nav.home" },
    { id: "discover", icon: <Compass className="h-[18px] w-[18px]" />,  labelKey: "nav.discover" },
    { id: "ai",       icon: <Sparkles className="h-[18px] w-[18px]" />, labelKey: "nav.ai" },
    { id: "connect",  icon: <MessageSquare className="h-[18px] w-[18px]" />, labelKey: "nav.connect" },
    { id: "rooms",    icon: <Users className="h-[18px] w-[18px]" />,    labelKey: "nav.rooms" },
  ];

  const secondary: NavItem[] = [
    { id: "notifications", icon: <Bell className="h-[18px] w-[18px]" />,          labelKey: "nav.notifications", badge: notifUnread > 0 ? notifUnread : null },
    { id: "profile",       icon: <User className="h-[18px] w-[18px]" />,          labelKey: "nav.profile" },
    { id: "settings",      icon: <SettingsIcon className="h-[18px] w-[18px]" />,  labelKey: "nav.settings" },
  ];

  // Display name with fallbacks: real name → derived from own email
  // (auth.users, NOT profiles — email column was removed from
  // profiles for privacy) → em-dash. profile.email is no longer
  // populated for new users so we don't read from it here.
  const displayName =
    profile?.name?.trim() ||
    "—";

  return (
    <nav
      aria-label="Primary"
      className="h-full flex flex-col py-5 px-4 gap-1"
    >
      {/* Header */}
      <div className="px-2 pb-4">
        <Logo size={26} onClick={() => setScreen("home")} />
      </div>

      {/* Cmd+K opener */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 h-10 px-3 rounded-full bg-surface-2 border border-line text-ink-3 text-sm hover:bg-surface-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-start">{t("cmd.placeholder")}</span>
        <kbd className="hidden lg:inline-flex items-center justify-center h-5 px-1.5 rounded bg-surface-1 border border-line text-[11px] font-mono text-ink-3">
          ⌘K
        </kbd>
      </button>

      {/* Primary nav */}
      <ul className="mt-4 flex flex-col gap-0.5">
        {primary.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={screen === item.id}
            onClick={() => setScreen(item.id)}
          />
        ))}
      </ul>

      {/* Separator */}
      <div className="h-px bg-line mx-2 my-4" />

      {/* Secondary nav */}
      <ul className="flex flex-col gap-0.5">
        {secondary.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={screen === item.id}
            onClick={() => setScreen(item.id)}
          />
        ))}
      </ul>

      {/* Spacer */}
      <div className="flex-1" />

      {/* New-post CTA */}
      {onNewPost && (
        <button
          type="button"
          onClick={onNewPost}
          className="flex items-center gap-2 h-11 px-4 rounded-full bg-ink-1 text-surface-0 font-medium text-sm shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="h-4 w-4" />
          <span>{t("shell.newPost")}</span>
        </button>
      )}

      {/* User card */}
      <button
        type="button"
        onClick={() => setScreen("profile")}
        className="mt-3 flex items-center gap-3 p-2 rounded-xl hover:bg-surface-2 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div
          className="relative h-9 w-9 rounded-full grid place-items-center text-sm font-semibold text-white"
          style={{ background: profile?.avatar_color || "#5B4BF5" }}
          aria-hidden
        >
          {profile?.photo_mode === "photo" && profile?.photo_url ? (
            <img
              src={profile.photo_url}
              alt=""
              className="h-full w-full object-cover rounded-full"
            />
          ) : (
            initials(displayName)
          )}
          <span
            className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-1 ${
              isOnline ? "bg-mint" : "bg-ink-4"
            }`}
            aria-label={isOnline ? "online" : "offline"}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-1 truncate">{displayName}</div>
          <div className="text-xs text-ink-3 truncate">
            {profile?.uni || (isOnline ? t("shell.online") : t("shell.offline"))}
          </div>
        </div>
      </button>
    </nav>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          active
            ? "bg-accent-soft text-accent-ink"
            : "text-ink-2 hover:bg-surface-2"
        }`}
      >
        <span className={active ? "text-accent" : "text-ink-3"}>{item.icon}</span>
        <span className="flex-1 text-start">{t(item.labelKey)}</span>
        {item.badge ? (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-semibold">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}
