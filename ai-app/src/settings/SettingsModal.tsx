/**
 * SettingsModal — the ChatGPT/Claude-style settings overlay.
 *
 * Layout:
 *   ┌─ Overlay ─────────────────────────────────────────────┐
 *   │  ┌─ Modal card ──────────────────────────────────────┐ │
 *   │  │ [Sidebar nav]  │  [Section header]            [X] │ │
 *   │  │  Account       │  ─────────────────────────────── │ │
 *   │  │  Subscription  │                                  │ │
 *   │  │  Usage         │  <ActiveSection />               │ │
 *   │  │  Memory        │                                  │ │
 *   │  │  Appearance    │                                  │ │
 *   │  │  Notifications │                                  │ │
 *   │  │  Data          │                                  │ │
 *   │  │  About         │                                  │ │
 *   │  └───────────────┴──────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────────┘
 *
 * Mobile: sidebar collapses to a horizontal scrolling pill bar
 * at the top of the card.
 */
import { useEffect } from "react";
import {
  User,
  CreditCard,
  BarChart3,
  Brain,
  Palette,
  Bell,
  ShieldCheck,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  closeSettings,
  listSections,
  setSettingsSection,
  useSettingsState,
  type SettingsSection,
} from "./useSettingsState";
import { AccountSection } from "./sections/AccountSection";
import { SubscriptionSection } from "./sections/SubscriptionSection";
import { UsageSection } from "./sections/UsageSection";
import { MemorySection } from "./sections/MemorySection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { DataSection } from "./sections/DataSection";
import { AboutSection } from "./sections/AboutSection";

const SECTION_META: Record<SettingsSection, { label: string; icon: LucideIcon; subtitle: string }> = {
  account:       { label: "Account",       icon: User,         subtitle: "Your profile and credentials" },
  subscription:  { label: "Subscription",  icon: CreditCard,   subtitle: "Plan, billing, and Sparks" },
  usage:         { label: "Usage",         icon: BarChart3,    subtitle: "Your activity and limits" },
  memory:        { label: "Memory",        icon: Brain,        subtitle: "Facts the AI remembers about you" },
  appearance:    { label: "Appearance",    icon: Palette,      subtitle: "Theme, language, and display" },
  notifications: { label: "Notifications", icon: Bell,         subtitle: "Email and push preferences" },
  data:          { label: "Data controls", icon: ShieldCheck,  subtitle: "Export, delete, and privacy" },
  about:         { label: "About",         icon: Info,         subtitle: "Version, legal, and support" },
};

export function SettingsModal() {
  const { open, section } = useSettingsState();

  // Lock body scroll while open — prevents the chat behind from scrolling
  // when the user scrolls within the modal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const Meta = SECTION_META[section];
  const Icon = Meta.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 backdrop-blur-sm p-3 sm:p-6"
      onClick={(e) => {
        // Close on backdrop click only (not inside the card)
        if (e.target === e.currentTarget) closeSettings();
      }}
    >
      <div
        className="
          w-full max-w-[920px] h-[92dvh] sm:h-[80dvh] max-h-[820px]
          bg-surface-1 rounded-2xl shadow-2xl border border-line/60
          flex flex-col sm:flex-row overflow-hidden
        "
      >
        {/* ── Sidebar (desktop) / horizontal pills (mobile) ── */}
        <aside
          className="
            sm:w-[220px] sm:shrink-0 sm:border-e sm:border-line/60
            border-b border-line/60 sm:border-b-0
            bg-surface-2/40
            overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto
            shrink-0
          "
        >
          <div className="hidden sm:block px-4 pt-5 pb-3">
            <h2 id="settings-title" className="font-serif italic text-lg text-ink-1">Settings</h2>
          </div>
          <nav className="flex sm:flex-col gap-1 p-2 sm:p-2 min-w-max sm:min-w-0">
            {listSections().map((s) => {
              const m = SECTION_META[s];
              const isActive = s === section;
              const I = m.icon;
              return (
                <button
                  key={s}
                  onClick={() => setSettingsSection(s)}
                  className={
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition " +
                    (isActive
                      ? "bg-surface-1 text-ink-1 shadow-sm border border-line/60"
                      : "text-ink-2 hover:bg-surface-1 hover:text-ink-1")
                  }
                >
                  <I className="h-4 w-4 shrink-0" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="flex items-center gap-3 px-5 sm:px-7 py-4 border-b border-line/60 shrink-0">
            <Icon className="h-5 w-5 text-ink-2 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-ink-1 truncate">{Meta.label}</h3>
              <p className="text-xs text-ink-3 truncate">{Meta.subtitle}</p>
            </div>
            <button
              onClick={closeSettings}
              aria-label="Close settings"
              className="h-9 w-9 grid place-items-center rounded-full text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 sm:py-6">
            {section === "account"       && <AccountSection />}
            {section === "subscription"  && <SubscriptionSection />}
            {section === "usage"         && <UsageSection />}
            {section === "memory"        && <MemorySection />}
            {section === "appearance"    && <AppearanceSection />}
            {section === "notifications" && <NotificationsSection />}
            {section === "data"          && <DataSection />}
            {section === "about"         && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
