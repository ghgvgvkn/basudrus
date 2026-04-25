/**
 * CommandPalette — Cmd+K / long-press-AI launcher.
 *
 * Two modes in this slice:
 *   - default   → Ask Omar (AI). Enter routes to the AI screen with
 *                 the typed query preloaded.
 *   - "/go …"   → screen jumps ("home", "discover", "settings", …).
 *
 * /find (profile search) is intentionally stubbed out for this bundle
 * — it depends on useDiscover which ports in slice 3. Re-enable by
 * wiring the discover hook back in; the UI scaffolding is already
 * there as commented-out code in the git history.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, ArrowRight, Hash } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useLocale } from "@/context/LocaleContext";

type Mode = "ai" | "go";

interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SCREEN_JUMPS: { id: string; keywords: string[]; labelKey: string }[] = [
  { id: "home",          keywords: ["home", "feed"],                     labelKey: "nav.home" },
  { id: "discover",      keywords: ["discover", "match", "people"],      labelKey: "nav.discover" },
  { id: "ai",            keywords: ["ai", "ustaz", "omar", "noor", "ask"],   labelKey: "nav.ai" },
  { id: "connect",       keywords: ["connect", "messages", "chat", "dm"],labelKey: "nav.connect" },
  { id: "rooms",         keywords: ["rooms", "groups"],                  labelKey: "nav.rooms" },
  { id: "notifications", keywords: ["notifications", "notifs", "alerts"],labelKey: "nav.notifications" },
  { id: "profile",       keywords: ["profile", "me"],                    labelKey: "nav.profile" },
  { id: "settings",      keywords: ["settings", "prefs", "preferences"], labelKey: "nav.settings" },
];

export function CommandPalette({ open, onOpenChange }: PaletteProps) {
  const { setScreen, setAIPrefill } = useApp();
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode: Mode = q.startsWith("/go") ? "go" : "ai";
  const query = mode === "ai" ? q : q.replace(/^\/go\s?/, "");

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    if (mode !== "go") return [];
    const needle = query.toLowerCase().trim();
    if (!needle) return SCREEN_JUMPS;
    return SCREEN_JUMPS.filter((s) =>
      s.keywords.some((k) => k.startsWith(needle)),
    );
  }, [mode, query]);

  useEffect(() => { setCursor(0); }, [q]);

  const commit = () => {
    if (mode === "ai") {
      setAIPrefill(q.trim());
      setScreen("ai");
      onOpenChange(false);
      return;
    }
    const pick = results[cursor];
    if (pick) {
      setScreen(pick.id);
      onOpenChange(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const max = Math.max(0, (mode === "ai" ? 0 : results.length) - 1);
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, max)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("cmd.title")}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-ink-1/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div className="w-full max-w-[560px] rounded-2xl bg-surface-1 border border-line shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
          {mode === "ai" ? (
            <Sparkles className="h-5 w-5 text-accent shrink-0" />
          ) : (
            <Search className="h-5 w-5 text-ink-3 shrink-0" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "ai" ? t("cmd.askPlaceholder") : t("cmd.goPlaceholder")}
            className="flex-1 bg-transparent outline-none text-ink-1 placeholder:text-ink-3 text-base"
          />
          <kbd className="text-[11px] font-mono text-ink-3 border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {mode === "ai" && !q && (
          <div className="px-4 py-3 flex flex-wrap gap-2 text-xs text-ink-3 border-b border-line">
            <span>{t("cmd.tryTyping")}</span>
            <button
              onClick={() => setQ("/go ")}
              className="px-2 py-0.5 rounded bg-surface-2 border border-line hover:bg-surface-3"
            >/go</button>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          {mode === "ai" && (
            <AskOmarRow query={q} onSubmit={commit} />
          )}

          {mode === "go" && (
            <ul>
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onClick={() => { setCursor(i); commit(); }}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full flex items-center gap-3 px-4 h-11 text-sm transition-colors ${i === cursor ? "bg-surface-2" : ""}`}
                  >
                    <Hash className="h-4 w-4 text-ink-3" />
                    <span className="flex-1 text-start text-ink-1">{t(r.labelKey)}</span>
                    <ArrowRight className="h-4 w-4 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-9 border-t border-line text-[11px] text-ink-3">
          <span className="flex items-center gap-1"><kbd className="font-mono border border-line rounded px-1">↑↓</kbd> {t("cmd.navigate")}</span>
          <span className="flex items-center gap-1"><kbd className="font-mono border border-line rounded px-1">⏎</kbd> {t("cmd.select")}</span>
          <span className="flex items-center gap-1 ms-auto"><kbd className="font-mono border border-line rounded px-1">⌘K</kbd> {t("cmd.toggle")}</span>
        </div>
      </div>
    </div>
  );
}

function AskOmarRow({ query, onSubmit }: { query: string; onSubmit: () => void }) {
  const { t } = useLocale();
  const hasQuery = query.trim().length > 0;
  return (
    <button
      onClick={onSubmit}
      disabled={!hasQuery}
      className={`w-full flex items-start gap-3 px-4 py-4 text-start transition-colors ${hasQuery ? "hover:bg-surface-2" : "opacity-60 cursor-default"}`}
    >
      <div className="h-8 w-8 rounded-full bg-accent-soft grid place-items-center shrink-0">
        <Sparkles className="h-4 w-4 text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-1">
          {hasQuery ? t("cmd.askUstazAbout") : t("cmd.askUstazAnything")}
        </div>
        {hasQuery && <div className="text-sm text-ink-2 line-clamp-2 mt-0.5">"{query}"</div>}
      </div>
      <ArrowRight className="h-4 w-4 text-ink-3 mt-2" />
    </button>
  );
}
