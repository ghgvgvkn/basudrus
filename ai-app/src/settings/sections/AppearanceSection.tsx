/**
 * AppearanceSection — theme, language, and text-density preferences.
 *
 * Reads/writes through the shared AppContext + LocaleContext so the
 * choice instantly applies on basudrus.com too (it's stored in
 * localStorage with a key both apps read).
 */
import { Sun, Moon, Monitor, Languages } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";
import { Group, Row, Switch } from "./parts";

type ThemeChoice = "light" | "dark" | "system";

function readSystemPref(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceSection() {
  const { darkMode, toggleDarkMode } = useApp();
  const { lang, toggleLang } = useLocale();

  // We don't have a dedicated "system" mode in the existing context —
  // darkMode is a boolean. Map the 3-button picker to that boolean.
  const current: ThemeChoice = darkMode ? "dark" : "light";

  const setTheme = (choice: ThemeChoice) => {
    if (choice === "system") {
      const want = readSystemPref();
      if (want !== darkMode) toggleDarkMode();
    } else {
      const want = choice === "dark";
      if (want !== darkMode) toggleDarkMode();
    }
  };

  return (
    <>
      <Group title="Theme">
        <div className="px-4 py-3.5">
          <div className="grid grid-cols-3 gap-2">
            <ThemeOption icon={Sun}     label="Light"  active={current === "light"}  onClick={() => setTheme("light")} />
            <ThemeOption icon={Moon}    label="Dark"   active={current === "dark"}   onClick={() => setTheme("dark")} />
            <ThemeOption icon={Monitor} label="System" active={false}                onClick={() => setTheme("system")} />
          </div>
          <p className="text-xs text-ink-3 mt-3">
            Choice syncs with basudrus.com — change here, see it there next refresh.
          </p>
        </div>
      </Group>

      <Group title="Language">
        <Row
          label={`Interface — ${lang === "ar" ? "العربية (Arabic)" : "English"}`}
          hint="Tony Starrk and Sherlock match the language you write in regardless of this setting."
          action={
            <button
              onClick={toggleLang}
              className="h-9 px-3.5 rounded-full border border-line/60 bg-surface-1 text-sm text-ink-1 hover:bg-surface-2 transition inline-flex items-center gap-1.5"
            >
              <Languages className="h-3.5 w-3.5" />
              Switch to {lang === "ar" ? "English" : "العربية"}
            </button>
          }
        />
      </Group>

      <Group title="Reading">
        <Row
          label="Compact mode"
          hint="Tighter spacing in chat. Useful on small laptops."
          action={<Switch on={false} onToggle={() => { /* TODO(future): wire when compact tokens land */ }} ariaLabel="Compact mode" />}
        />
        <Row
          label="Larger text"
          hint="Bumps message body to 16px (default 14px)."
          action={<Switch on={false} onToggle={() => { /* TODO(future): scoped font-size override via :root */ }} ariaLabel="Larger text" />}
        />
      </Group>
    </>
  );
}

function ThemeOption({
  icon: Icon, label, active, onClick,
}: {
  icon: typeof Sun;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-col items-center gap-1.5 py-3 rounded-xl border transition " +
        (active
          ? "bg-accent/10 border-accent/40 text-ink-1 shadow-sm"
          : "bg-surface-1 border-line/60 text-ink-2 hover:bg-surface-2")
      }
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

