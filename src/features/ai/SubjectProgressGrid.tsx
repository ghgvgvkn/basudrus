/**
 * SubjectProgressGrid — visual per-subject progress for the Profile
 * screen (and anywhere else we want to show "what you've been
 * studying"). Each card uses the per-subject palette so a math card
 * is indigo, biology is green, etc.
 *
 * Card surface (per subject the user has at least one session in):
 *   • Big emoji + label (palette-tinted)
 *   • Mastery bar (0-100%) — fills with the accent color
 *   • Sessions count, topics count, last studied (relative)
 *   • Weak / strong areas footer (small, only when ≥1 of each)
 *
 * Layout: responsive grid, 1-column on mobile, 2-column on tablet,
 * 3-column on wide. Empty state ("no progress yet — start a chat")
 * shown when the user has no tutor_progress rows. Loading state is a
 * subtle skeleton, not a spinner — fades in when ready.
 */
import { paletteFor } from "./subjectPalette";
import { useSubjectProgress, type SubjectProgressSummary } from "./useSubjectProgress";

function formatRelative(iso: string | null): string {
  if (!iso) return "Not yet";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Not yet";
  const ms = Date.now() - t;
  const m = Math.round(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.round(d / 7)} wk ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${Math.round(d / 365)} yr ago`;
}

function ProgressCard({ row }: { row: SubjectProgressSummary }) {
  const p = paletteFor(row.subject);
  const masteryPct = Math.round(row.masteryHint * 100);
  return (
    <div
      className="relative rounded-2xl p-5 overflow-hidden border transition hover:scale-[1.01]"
      style={{
        background: p.soft,
        borderColor: `${p.accent}33`,
      }}
    >
      {/* Top: emoji + label + mastery % */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-xl shrink-0"
            style={{ background: `${p.accent}1F` }}
            aria-hidden
          >
            {p.emoji}
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink truncate">{p.label}</div>
            <div className="text-[12px] text-ink/55">
              {row.sessionsCount} {row.sessionsCount === 1 ? "session" : "sessions"}
              {row.topicsCount > 0 ? ` · ${row.topicsCount} ${row.topicsCount === 1 ? "topic" : "topics"}` : ""}
            </div>
          </div>
        </div>
        <div
          className="shrink-0 text-[13px] font-semibold tabular-nums"
          style={{ color: p.accent }}
          aria-label={`Mastery: ${masteryPct}%`}
        >
          {masteryPct}%
        </div>
      </div>

      {/* Mastery bar — fills with the palette accent. Width is animated
          via Tailwind's transition; the inline width updates the
          rendered % when the data refreshes. */}
      <div
        className="mt-3 h-1.5 w-full rounded-full overflow-hidden"
        style={{ background: `${p.accent}1A` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={masteryPct}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${masteryPct}%`,
            background: p.accent,
          }}
        />
      </div>

      {/* Footer: last studied + strong/weak counts */}
      <div className="mt-4 flex items-center justify-between text-[11.5px] text-ink/55">
        <span>Last: {formatRelative(row.lastSessionAt)}</span>
        {(row.strongCount > 0 || row.weakCount > 0) && (
          <span className="inline-flex items-center gap-2">
            {row.strongCount > 0 && (
              <span title={`${row.strongCount} strong areas`}>
                <span className="font-semibold" style={{ color: p.accent }}>{row.strongCount}</span> strong
              </span>
            )}
            {row.weakCount > 0 && (
              <span title={`${row.weakCount} weak areas to review`}>
                <span className="font-semibold text-rose-600">{row.weakCount}</span> review
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-ink/10 px-6 py-10 text-center">
      <div className="text-3xl mb-2" aria-hidden>📚</div>
      <div className="text-[15px] font-semibold text-ink">No progress yet</div>
      <p className="mt-1 text-[13px] text-ink/55 max-w-sm mx-auto leading-relaxed">
        Start a chat with Bas Udros and your first session will show up here. Every subject you study gets its own card.
      </p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 border border-ink/10 bg-ink/[3%]">
      <div className="flex items-start gap-3 animate-pulse">
        <div className="w-10 h-10 rounded-xl bg-ink/10" />
        <div className="flex-1 min-w-0">
          <div className="h-4 w-24 rounded bg-ink/10" />
          <div className="mt-2 h-3 w-16 rounded bg-ink/10" />
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-ink/10 animate-pulse" />
      <div className="mt-4 h-3 w-32 rounded bg-ink/10 animate-pulse" />
    </div>
  );
}

interface Props {
  /** Optional title — when omitted the caller is expected to provide
   *  its own section header. Default: "Subject progress". */
  title?: string;
  /** Show the title as part of the component (default true). Set
   *  false when the parent renders its own heading. */
  showTitle?: boolean;
}

export function SubjectProgressGrid({ title = "Subject progress", showTitle = true }: Props) {
  const { rows, loading } = useSubjectProgress();
  return (
    <section>
      {showTitle && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {!loading && rows.length > 0 && (
            <span className="text-[12px] text-ink/55 tabular-nums">
              {rows.length} {rows.length === 1 ? "subject" : "subjects"}
            </span>
          )}
        </div>
      )}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}
      {!loading && rows.length === 0 && <EmptyState />}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <ProgressCard key={String(r.subject)} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}
