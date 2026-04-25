/**
 * TopBar — 48px mobile header.
 *
 * Slots (all optional):
 *   - left:   defaults to back arrow on sub-screens, nothing on roots
 *   - center: defaults to serif-italic screen title; skipped on Home
 *   - right:  defaults to [search, bell]
 *
 * Screens override via props. Example — chat thread replaces center
 * with contact name+avatar and hides bell:
 *
 *   <TopBar
 *     back="Messages"
 *     center={<ContactHeader profile={partner} />}
 *     rightActions={["search"]}  // bell omitted
 *   />
 *
 * Shown ONLY on mobile (lg:hidden). Desktop chrome is the Sidebar.
 */
import type { ReactNode } from "react";
import { ArrowLeft, Search, Bell } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";

export interface TopBarProps {
  /** If set, shows a back arrow; clicking navigates to this screen. */
  back?: string;
  /** Override center content. Defaults to `title` in serif italic. */
  center?: ReactNode;
  /** Title for center slot. Falls back to t(`nav.${screen}`). */
  title?: string;
  /** Pick which default right-icon actions to show. */
  rightActions?: Array<"search" | "bell">;
  /** Fully replace the right slot. */
  right?: ReactNode;
  /** Palette opener, wired from Shell. */
  onOpenPalette?: () => void;
}

export function TopBar({
  back,
  center,
  title,
  rightActions = ["search", "bell"],
  right,
  onOpenPalette,
}: TopBarProps) {
  const { screen, setScreen } = useApp();
  const { t } = useLocale();

  // Home has no title — the feed is self-explanatory and the serif
  // would fight with the greeting card. Other screens get the
  // t(`nav.${screen}`) string unless overridden.
  const defaultTitle =
    screen === "home" ? null : (title ?? t(`nav.${screen}`));

  const leftSlot = back ? (
    <button
      type="button"
      onClick={() => setScreen(back)}
      aria-label={t("top.back")}
      className="h-10 w-10 -ms-2 grid place-items-center text-ink-2 rounded-full hover:bg-surface-2 active:scale-95 transition-transform"
    >
      <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
    </button>
  ) : (
    <div className="w-6" aria-hidden />
  );

  const centerSlot = center ?? (defaultTitle && (
    <div
      className="serif text-[19px] text-ink-1 truncate"
      style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
    >
      {defaultTitle}
    </div>
  ));

  const rightSlot =
    right !== undefined ? right : (
      <div className="flex items-center gap-1">
        {rightActions.includes("search") && (
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label={t("top.search")}
            className="h-10 w-10 grid place-items-center text-ink-2 rounded-full hover:bg-surface-2 active:scale-95 transition-transform"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        )}
        {rightActions.includes("bell") && (
          <button
            type="button"
            onClick={() => setScreen("notifications")}
            aria-label={t("top.notifications")}
            className="h-10 w-10 grid place-items-center text-ink-2 rounded-full hover:bg-surface-2 active:scale-95 transition-transform relative"
          >
            <Bell className="h-[18px] w-[18px]" />
            {/* Unread dot — TODO: wire real count in slice 3 */}
            <span className="absolute top-2 end-2 h-2 w-2 rounded-full bg-accent" />
          </button>
        )}
      </div>
    );

  return (
    <header
      className="lg:hidden sticky top-0 z-20 h-12 bg-surface-0/90 backdrop-blur-lg border-b border-line flex items-center px-3 gap-2"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="w-10 flex items-center">{leftSlot}</div>
      <div className="flex-1 min-w-0 flex items-center justify-center">{centerSlot}</div>
      <div className="w-auto flex items-center justify-end">{rightSlot}</div>
    </header>
  );
}
