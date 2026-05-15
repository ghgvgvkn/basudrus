/**
 * SettingsScreen — single-column settings list.
 *
 * Rows that don't yet have a real destination are clearly labelled
 * "Coming soon" and rendered as disabled. Without that, every tap on
 * a stub used to feel like a broken app — the row was a real-looking
 * button with no onClick, so tapping it did nothing visible. Users
 * (correctly) read that as "the whole settings page is broken."
 *
 * The one row that DOES work in production is Sign out — wired to
 * Supabase's global signOut. We confirm with the user before firing
 * since it's destructive (you lose your current session everywhere).
 */
import { useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { useSupabaseSession, signOutEverywhere } from "@/features/auth/useSupabaseSession";
import { ChevronRight, Moon, Globe, Bell, Shield, LogOut, Loader2 } from "lucide-react";

export function SettingsScreen() {
  const { darkMode, toggleDarkMode, setScreen } = useApp();
  const { lang, toggleLang } = useLocale();
  const { user } = useSupabaseSession();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutEverywhere();
      // Returning to landing — the auth listener will clear context
      // state once Supabase fires the SIGNED_OUT event, but routing
      // back now feels snappier than waiting for the round trip.
      setScreen?.("landing");
    } finally {
      setSigningOut(false);
      setConfirmSignOut(false);
    }
  };

  return (
    <>
      <TopBar title="Settings" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[720px] mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
        <Group title="Preferences">
          <Toggle Icon={Moon}  label="Dark mode" on={darkMode} onToggle={toggleDarkMode} />
          <Toggle Icon={Globe} label={`Language — ${lang === "ar" ? "العربية" : "English"}`} on={lang === "ar"} onToggle={toggleLang} />
        </Group>

        <Group title="Notifications">
          <Row Icon={Bell} label="Push notifications" comingSoon />
          <Row Icon={Bell} label="Email digests" comingSoon />
        </Group>

        <Group title="Privacy">
          <Row Icon={Shield} label="Who can message me" comingSoon />
          <Row Icon={Shield} label="Profile visibility" comingSoon />
        </Group>

        {user && (
          <Group title="Account">
            <li>
              {confirmSignOut ? (
                <div className="px-4 py-3 flex items-center gap-3">
                  <span className="flex-1 text-sm text-ink-1">Sign out of this device?</span>
                  <button
                    onClick={() => setConfirmSignOut(false)}
                    disabled={signingOut}
                    className="h-8 px-3 rounded-full text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                  >Cancel</button>
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="h-8 px-3 rounded-full bg-red-500 text-white text-xs font-medium disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    {signingOut && <Loader2 className="h-3 w-3 animate-spin" />}
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmSignOut(true)}
                  className="w-full flex items-center gap-3 px-4 h-12 text-sm hover:bg-surface-2 text-red-500"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                  <span className="flex-1 text-start">Sign out</span>
                  <ChevronRight className="h-4 w-4 text-ink-3 rtl:rotate-180" />
                </button>
              )}
            </li>
          </Group>
        )}

        <p className="text-xs text-ink-3 text-center pt-4">Bas Udrus · v0.1.0 · Study Partners</p>
      </div>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider text-ink-3 mb-2 px-1">{title}</h2>
      <ul className="bu-card divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  );
}

function Row({
  Icon, label, onClick, destructive = false, comingSoon = false,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  comingSoon?: boolean;
}) {
  // Rows without an onClick AND without a comingSoon flag would have
  // been silently dead — that's the bug we're fixing here. The
  // `disabled` styling tells the user this surface isn't live yet
  // instead of looking like a broken control.
  const isDead = !onClick && !comingSoon;
  return (
    <li>
      <button
        onClick={onClick}
        disabled={!onClick}
        aria-disabled={!onClick}
        className={
          "w-full flex items-center gap-3 px-4 h-12 text-sm transition " +
          (onClick
            ? `hover:bg-surface-2 ${destructive ? "text-red-500" : "text-ink-1"}`
            : "text-ink-3 cursor-not-allowed")
        }
      >
        <Icon className="h-[18px] w-[18px] text-ink-3" />
        <span className="flex-1 text-start">{label}</span>
        {comingSoon && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-ink-1/5 text-ink-3">
            Coming soon
          </span>
        )}
        {!isDead && onClick && <ChevronRight className="h-4 w-4 text-ink-3 rtl:rotate-180" />}
      </button>
    </li>
  );
}

function Toggle({ Icon, label, on, onToggle }: { Icon: React.ComponentType<{ className?: string }>; label: string; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 h-12 text-sm text-ink-1 hover:bg-surface-2">
        <Icon className="h-[18px] w-[18px] text-ink-3" />
        <span className="flex-1 text-start">{label}</span>
        <span className={`w-9 h-5 rounded-full relative transition-colors ${on ? "bg-accent" : "bg-surface-3"}`}>
          <span className={`absolute top-0.5 ${on ? "start-[18px]" : "start-0.5"} h-4 w-4 rounded-full bg-white transition-all`} />
        </span>
      </button>
    </li>
  );
}
