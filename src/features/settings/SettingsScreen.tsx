/**
 * SettingsScreen — single-column settings list.
 *
 * Sub-pages (edit profile, privacy, notifications prefs, etc.) are
 * stubbed as disabled rows; slice 3 drops in the real forms. The
 * TopBar's `back="settings"` pattern is how those sub-pages will
 * navigate back.
 */
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { ChevronRight, Moon, Globe, Bell, Shield, LogOut } from "lucide-react";

export function SettingsScreen() {
  const { darkMode, toggleDarkMode } = useApp();
  const { lang, toggleLang } = useLocale();

  return (
    <>
      <TopBar title="Settings" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[720px] mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
        <Group title="Preferences">
          <Toggle Icon={Moon}  label="Dark mode" on={darkMode} onToggle={toggleDarkMode} />
          <Toggle Icon={Globe} label={`Language — ${lang === "ar" ? "العربية" : "English"}`} on={lang === "ar"} onToggle={toggleLang} />
        </Group>

        <Group title="Notifications">
          <Row Icon={Bell} label="Push notifications" />
          <Row Icon={Bell} label="Email digests" />
        </Group>

        <Group title="Privacy">
          <Row Icon={Shield} label="Who can message me" />
          <Row Icon={Shield} label="Profile visibility" />
        </Group>

        <Group title="Account">
          <Row Icon={LogOut} label="Sign out" destructive />
        </Group>

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

function Row({ Icon, label, destructive = false }: { Icon: React.ComponentType<{ className?: string }>; label: string; destructive?: boolean }) {
  return (
    <li>
      <button className={`w-full flex items-center gap-3 px-4 h-12 text-sm hover:bg-surface-2 ${destructive ? "text-red-500" : "text-ink-1"}`}>
        <Icon className="h-[18px] w-[18px] text-ink-3" />
        <span className="flex-1 text-start">{label}</span>
        <ChevronRight className="h-4 w-4 text-ink-3 rtl:rotate-180" />
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
