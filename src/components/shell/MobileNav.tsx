/**
 * MobileNav — bottom tab bar for screens <lg.
 *
 * 5 slots: Home · Discover · AI (center, elevated) · Connect · Profile.
 * AI (Omar): single-tap navigates to AI screen. Long-press (450ms) opens
 * the command palette. Search icon also lives in TopBar — the
 * long-press is a power-user shortcut.
 *
 * Safe-area: pb-[env(safe-area-inset-bottom)] so it floats above
 * the iOS home indicator.
 */
import { useRef } from "react";
import { Home, Compass, Sparkles, MessageSquare, User } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";

export function MobileNav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { screen, setScreen } = useApp();
  const { t } = useLocale();
  const longPressTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);

  const left = [
    { id: "home",     Icon: Home,    labelKey: "nav.home" },
    { id: "discover", Icon: Compass, labelKey: "nav.discover" },
  ];
  const right = [
    { id: "connect", Icon: MessageSquare, labelKey: "nav.connect" },
    { id: "profile", Icon: User,          labelKey: "nav.profile" },
  ];

  const onAIDown = () => {
    didLongPress.current = false;
    longPressTimer.current = window.setTimeout(() => {
      didLongPress.current = true;
      onOpenPalette();
    }, 450);
  };
  const onAIUp = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!didLongPress.current) setScreen("ai");
  };
  const onAICancel = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    didLongPress.current = false;
  };

  return (
    <nav
      aria-label="Primary (mobile)"
      className="bg-surface-1/95 backdrop-blur-lg border-t border-line"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="relative grid grid-cols-5 h-[64px] items-stretch">
        {left.map((t) => (
          <Tab key={t.id} {...t} active={screen === t.id} onClick={() => setScreen(t.id)} />
        ))}

        <li className="relative flex items-center justify-center">
          <button
            type="button"
            onPointerDown={onAIDown}
            onPointerUp={onAIUp}
            onPointerCancel={onAICancel}
            onPointerLeave={onAICancel}
            aria-label={t("nav.ai") + " — tap to open, hold for search"}
            className="absolute -top-5 h-14 w-14 rounded-full bg-accent text-white grid place-items-center shadow-[var(--shadow-ai)] active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            <Sparkles className="h-6 w-6" />
          </button>
        </li>

        {right.map((tab) => (
          <Tab key={tab.id} {...tab} active={screen === tab.id} onClick={() => setScreen(tab.id)} />
        ))}
      </ul>
    </nav>
  );
}

function Tab({
  Icon, labelKey, active, onClick,
}: {
  id: string;
  Icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
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
        className={`w-full h-full flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors focus:outline-none ${active ? "text-accent" : "text-ink-3"}`}
      >
        <Icon className="h-[22px] w-[22px]" />
        <span className={active ? "font-semibold" : "font-medium"}>{t(labelKey)}</span>
      </button>
    </li>
  );
}
