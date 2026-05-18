/**
 * ModelPicker — Claude-style model selector chip.
 *
 * Appears next to the composer mode pills. Shows the active model
 * name. Tap opens a small popover with selectable options. Free-tier
 * users see Pro models grayed out with a lock icon — the chip
 * primes the upgrade conversation without forcing it.
 *
 * Server-side model routing is unchanged today — the chip is
 * informational + sets the UX expectation. When you wire real
 * server-side model switching later (e.g. Pro users get Sonnet), the
 * client already has the `selected` state and the API can read it
 * from the request body.
 *
 * Stores selection in localStorage so a returning student keeps
 * their preferred model. Tier-gated options that they previously
 * picked fall back gracefully to the default.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Lock, Check } from "lucide-react";

export type ModelId = "haiku-4.5" | "sonnet-4.5" | "groq-llama-4";

export interface ModelOption {
  id: ModelId;
  label: string;
  /** One-line description shown in the dropdown. */
  description: string;
  /** Pro / paid tier required. Free users see a lock + disabled state. */
  proRequired?: boolean;
  /** Optional small tag under the label ("Default", "Faster", "Smarter"). */
  badge?: string;
}

const STORAGE_KEY = "bu:preferred-model";

// Note: `id` values are stable storage keys saved to localStorage —
// keep them as-is so returning users don't lose their preference.
// Only `label` (the visible name in the chip + dropdown) is branded.
const MODELS: ModelOption[] = [
  {
    id: "haiku-4.5",
    label: "Cooked 2.3",
    description: "Fast and reliable. Default for everyone.",
    badge: "Default",
  },
  {
    id: "sonnet-4.5",
    label: "Cooking 2.9",
    description: "Smarter on hard problems. Slower, more thorough.",
    badge: "Pro",
    proRequired: true,
  },
  {
    id: "groq-llama-4",
    label: "Llama 4 Maverick",
    description: "Open-source via Groq. Fast token speed, no vision.",
    badge: "Beta",
    proRequired: true,
  },
];

function readStoredModel(): ModelId {
  if (typeof window === "undefined") return "haiku-4.5";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && MODELS.some((m) => m.id === raw)) {
      return raw as ModelId;
    }
  } catch {}
  return "haiku-4.5";
}

function writeStoredModel(id: ModelId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

interface ModelPickerProps {
  /** True when the user is on the Pro tier — controls which models
   *  are selectable. Free users can still SEE the locked options
   *  to understand what's possible. */
  isPro?: boolean;
  /** Callback fired when the user picks a different model. Optional —
   *  the chip works as informational display without it. */
  onChange?: (id: ModelId) => void;
}

export function ModelPicker({ isPro = false, onChange }: ModelPickerProps) {
  const [selected, setSelected] = useState<ModelId>(readStoredModel);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = MODELS.find((m) => m.id === selected) || MODELS[0];

  const pick = (m: ModelOption) => {
    if (m.proRequired && !isPro) return; // locked — no-op
    setSelected(m.id);
    writeStoredModel(m.id);
    onChange?.(m.id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-ink/12 bg-bg text-ink/65 hover:text-ink hover:bg-ink/5 transition text-[12px] font-medium"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#5B4BF5]" aria-hidden />
        <span>{active.label}</span>
        <ChevronDown size={12} className="text-ink/40" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-40 bottom-[calc(100%+6px)] right-0 w-[280px] rounded-2xl border border-ink/12 bg-bg shadow-lg p-1.5"
        >
          {MODELS.map((m) => {
            const isSelected = m.id === selected;
            const locked = m.proRequired && !isPro;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={locked}
                onClick={() => pick(m)}
                disabled={locked}
                className={`w-full text-left rounded-xl px-3 py-2 transition flex items-start gap-2.5 ${
                  locked
                    ? "opacity-55 cursor-not-allowed"
                    : "hover:bg-ink/5"
                } ${isSelected ? "bg-ink/4" : ""}`}
              >
                <span className="mt-[3px] shrink-0">
                  {locked ? (
                    <Lock size={13} className="text-ink/35" />
                  ) : isSelected ? (
                    <Check size={13} className="text-[#5B4BF5]" />
                  ) : (
                    <span className="w-[13px] h-[13px] inline-block" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-ink">{m.label}</span>
                    {m.badge && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-[1px] rounded-full bg-ink/8 text-ink/55">
                        {m.badge}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-ink/55 mt-0.5 leading-relaxed">
                    {m.description}
                  </span>
                </span>
              </button>
            );
          })}
          {!isPro && (
            <div className="px-3 pt-2 pb-1 text-[11px] text-ink/45 border-t border-ink/8 mt-1">
              Smarter models unlock with Pro.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
