/**
 * Shared layout primitives used by every settings section.
 * Keeps visual rhythm consistent: Field / Row / Group / Tag.
 */
import type { ReactNode } from "react";

export function Group({ title, children, hint }: { title?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="mb-6">
      {(title || hint) && (
        <div className="mb-2 px-1 flex items-baseline justify-between gap-3">
          {title && <h4 className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{title}</h4>}
          {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
        </div>
      )}
      <div className="rounded-xl bg-surface-2/50 border border-line/60 divide-y divide-line/40">
        {children}
      </div>
    </section>
  );
}

export function Field({
  label, value, action, sublabel,
}: {
  label: string;
  value?: ReactNode;
  action?: ReactNode;
  sublabel?: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-1 font-medium">{label}</div>
        {sublabel && <div className="text-xs text-ink-3 mt-0.5">{sublabel}</div>}
        {value !== undefined && (
          <div className="text-sm text-ink-2 mt-1 truncate">{value}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Row({
  label, hint, action,
}: {
  label: string;
  hint?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-1">{label}</div>
        {hint && <div className="text-xs text-ink-3 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function Tag({
  children, tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "success";
}) {
  const cls =
    tone === "accent"  ? "bg-accent/10 text-accent" :
    tone === "warn"    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
    tone === "danger"  ? "bg-red-500/10 text-red-600" :
    tone === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" :
                         "bg-ink-1/5 text-ink-2";
  return (
    <span className={`text-[10px] uppercase tracking-[0.08em] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {children}
    </span>
  );
}

export function PrimaryButton({
  children, onClick, disabled, type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="
        h-9 px-4 rounded-full bg-ink-1 text-surface-1 text-sm font-medium
        hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed
        transition
      "
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, onClick, disabled, tone = "neutral",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  const cls =
    tone === "danger"
      ? "text-red-600 border-red-500/30 hover:bg-red-500/5"
      : "text-ink-1 border-line/60 hover:bg-surface-2";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-9 px-3.5 rounded-full text-sm font-medium border bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed transition ${cls}`}
    >
      {children}
    </button>
  );
}

export function Switch({ on, onToggle, ariaLabel }: { on: boolean; onToggle: () => void; ariaLabel?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`relative h-6 w-10 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-3"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "start-[18px]" : "start-0.5"}`}
      />
    </button>
  );
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "warn" }) {
  const cls =
    tone === "info" ? "bg-accent/5 text-ink-1 border-accent/20" :
    tone === "warn" ? "bg-amber-500/5 text-ink-1 border-amber-500/30" :
                      "bg-surface-2/60 text-ink-2 border-line/60";
  return (
    <p className={`text-xs leading-relaxed px-3 py-2.5 rounded-lg border ${cls}`}>{children}</p>
  );
}
