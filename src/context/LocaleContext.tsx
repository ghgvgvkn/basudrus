/**
 * Locale + direction context.
 *
 * Owns the UI-chrome language (not the AI output language — that's
 * `aiLang` in useAI, and the two are intentionally separate: a user
 * may want the interface in Arabic but Claude's answers in English,
 * or vice versa).
 *
 * Persistence: localStorage["bu:lang"]. Initial read is synchronous
 * in the useState initializer so we don't flash the wrong direction.
 *
 * Side effects: whenever `lang` changes we write
 *   document.documentElement.lang = "en" | "ar"
 *   document.documentElement.dir  = "ltr" | "rtl"
 * so Tailwind's `rtl:` / `ltr:` variants (and any third-party widget
 * that reads the `dir` attribute) pick up the change without every
 * component having to thread direction through props.
 *
 * t(key): a tiny inline dictionary. Enough for Shell + top-level
 * nav labels. Feature screens still hardcode English for now — we'll
 * migrate to a real i18n library (formatjs) in a later PR once the
 * copy stabilises.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "ar";
export type Dir = "ltr" | "rtl";

export interface LocaleValue {
  lang: Lang;
  dir: Dir;
  setLang: (l: Lang) => void;
  /** Toggle between en/ar — for the single-button switcher in Settings. */
  toggleLang: () => void;
  /** Look up a chrome string. Falls back to key if missing. */
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

const STORAGE_KEY = "bu:lang";

/**
 * Chrome dictionary. Keep it small — only strings that appear in
 * Shell, Sidebar, CommandPalette, and the nav labels themselves.
 * Feature screens will migrate to formatjs later.
 *
 * Keys follow a `section.item` convention. Adding a new key? Add
 * it to BOTH `en` and `ar` so the type check catches mismatches.
 */
const dict = {
  en: {
    "nav.home": "Home",
    "nav.discover": "Discover",
    "nav.ai": "AI (Omar)",
    "nav.connect": "Messages",
    "nav.rooms": "Rooms",
    "nav.profile": "Profile",
    "nav.notifications": "Notifications",
    "nav.settings": "Settings",
    "nav.more": "More",
    "cmd.placeholder": "Ask Omar anything…",
    "cmd.hint": "⌘K to open",
    "cmd.empty": "No results. Press Enter to ask Omar.",
    "cmd.askPlaceholder": "Ask Omar anything…",
    "cmd.goPlaceholder": "Jump to a screen…",
    "cmd.title": "Command palette",
    "cmd.askUstazAnything": "Ask AI (Omar) anything",
    "cmd.askUstazAbout": "Ask Omar about…",
    "cmd.navigate": "Navigate",
    "cmd.select": "Select",
    "cmd.toggle": "Toggle",
    "cmd.tryTyping": "Try:",
    "shell.newPost": "Post for help",
    "shell.online": "Online",
    "shell.offline": "Offline",
    "top.search": "Search",
    "top.back": "Back",
    "top.notifications": "Notifications",
  },
  ar: {
    "nav.home": "الرئيسية",
    "nav.discover": "اكتشف",
    "nav.ai": "AI (Omar)",
    "nav.connect": "الرسائل",
    "nav.rooms": "الغرف",
    "nav.profile": "الملف",
    "nav.notifications": "الإشعارات",
    "nav.settings": "الإعدادات",
    "nav.more": "المزيد",
    "cmd.placeholder": "اسأل الأستاذ أي شيء…",
    "cmd.hint": "⌘K للفتح",
    "cmd.empty": "لا نتائج. اضغط إدخال لسؤال الأستاذ.",
    "cmd.askPlaceholder": "اسأل الأستاذ أي شيء…",
    "cmd.goPlaceholder": "انتقل إلى شاشة…",
    "cmd.title": "لوحة الأوامر",
    "cmd.askUstazAnything": "اسأل عمر أي شيء",
    "cmd.askUstazAbout": "اسأل عمر عن…",
    "cmd.navigate": "تنقّل",
    "cmd.select": "اختر",
    "cmd.toggle": "تبديل",
    "cmd.tryTyping": "جرّب:",
    "shell.newPost": "اطلب مساعدة",
    "shell.online": "متصل",
    "shell.offline": "غير متصل",
    "top.search": "بحث",
    "top.back": "رجوع",
    "top.notifications": "الإشعارات",
  },
} as const satisfies Record<Lang, Record<string, string>>;

type DictKey = keyof typeof dict.en;

function readInitialLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    /* storage unavailable — fall through */
  }
  // Not set: honour the browser preference ONCE, then latch it.
  const browser = typeof navigator !== "undefined" ? navigator.language : "";
  return browser.startsWith("ar") ? "ar" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  const dir: Dir = lang === "ar" ? "rtl" : "ltr";

  // Apply to <html> so all descendant `dir:` / `lang:` selectors
  // resolve correctly. We do this in an effect (not render) because
  // document isn't available during SSR, and we want the initial
  // sync run on mount even if lang matches the default.
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable — setting still takes effect for this session */
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === "en" ? "ar" : "en");
  }, [lang, setLang]);

  const t = useCallback(
    (key: string): string => {
      const table = dict[lang] as Record<string, string>;
      return table[key] ?? dict.en[key as DictKey] ?? key;
    },
    [lang]
  );

  const value = useMemo<LocaleValue>(
    () => ({ lang, dir, setLang, toggleLang, t }),
    [lang, dir, setLang, toggleLang, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
