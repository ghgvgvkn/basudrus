/**
 * ReportBlockModal — single modal for reporting AND/OR blocking a user.
 *
 * Triggered from any "..." menu on a profile / message / room member.
 * Two actions in one flow because they almost always go together: a
 * user who wants to report someone almost always also wants to block
 * them, and vice versa. Splitting them into separate UIs creates
 * friction at the worst moment.
 *
 * Writes:
 *   - INSERT into `reports` if a reason is selected (server-side
 *     RLS limits reporter_id = auth.uid())
 *   - INSERT into `user_blocks` if "also block" is checked
 *
 * Both tables already exist with the right RLS policies; this UI just
 * exercises them.
 */
import { useState } from "react";
import { X, AlertTriangle, ShieldOff, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";

const REASONS: Array<{ value: string; label: string; description: string }> = [
  { value: "harassment",   label: "Harassment / bullying",
    description: "Threats, insults, repeated unwanted contact." },
  { value: "spam",         label: "Spam / scam",
    description: "Selling, phishing, off-topic promotion." },
  { value: "inappropriate", label: "Inappropriate content",
    description: "Sexual, violent, or graphic material." },
  { value: "fake",         label: "Fake account",
    description: "Impersonation or misleading identity." },
  { value: "underage",     label: "Underage user",
    description: "Appears to be under 16. We'll review urgently." },
  { value: "other",        label: "Something else",
    description: "Doesn't fit the categories above." },
];

export function ReportBlockModal({
  reportedUserId,
  reportedUserName,
  onClose,
}: {
  reportedUserId: string;
  reportedUserName: string;
  onClose: () => void;
}) {
  const { user } = useSupabaseSession();
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | "report+block" | "block-only" | "report-only">(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!user || !supabase) {
      setErr("Sign in to report or block.");
      return;
    }
    if (!reason && !alsoBlock) {
      setErr("Pick a reason or check 'also block'.");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      let didReport = false;
      let didBlock = false;

      if (reason) {
        const { error: repErr } = await supabase.from("reports").insert({
          reporter_id: user.id,
          reported_id: reportedUserId,
          reason,
          detail: detail.trim().slice(0, 1000),
        });
        if (repErr) throw repErr;
        didReport = true;
      }

      if (alsoBlock) {
        const { error: blockErr } = await supabase.from("user_blocks").insert({
          blocker_id: user.id,
          blocked_id: reportedUserId,
        });
        // Idempotent — duplicate primary-key error is fine.
        if (blockErr && !/duplicate|unique/i.test(blockErr.message)) throw blockErr;
        didBlock = true;
      }

      setDone(
        didReport && didBlock ? "report+block" :
        didBlock ? "block-only" :
        "report-only",
      );

      // Tell the rest of the app to refilter (Discover, Connect, etc.)
      // Each consumer can listen for `bu:user-blocked` and re-fetch.
      try { window.dispatchEvent(new CustomEvent("bu:user-blocked", { detail: { blockedId: reportedUserId } })); } catch { /* noop */ }

      // Brief pause so the user sees the success state, then close.
      setTimeout(onClose, 1400);
    } catch (e) {
      setSubmitting(false);
      setErr(e instanceof Error ? e.message : "Couldn't submit. Try again.");
    }
  };

  // Success state — show what happened, then auto-close.
  if (done) {
    return (
      <Backdrop onClose={onClose}>
        <Sheet>
          <div className="text-center py-6">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#0E8A6B]/10 text-[#0E8A6B] grid place-items-center mb-4">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="serif text-2xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>Done.</h3>
            <p className="text-ink-3 text-sm">
              {done === "report+block"
                ? `Reported and blocked ${reportedUserName}. They won't appear in your feeds.`
                : done === "block-only"
                  ? `Blocked ${reportedUserName}.`
                  : `Reported ${reportedUserName}. We'll review it.`}
            </p>
          </div>
        </Sheet>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <Sheet>
        <header className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#C23F6C]/10 text-[#C23F6C] grid place-items-center shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="serif text-xl text-ink-1" style={{ fontStyle: "italic" }}>
                Report or block
              </div>
              <div className="text-xs text-ink-3 truncate">{reportedUserName}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-9 w-9 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-6 pt-2 pb-3">
          <p className="text-sm text-ink-2 mb-3">
            What's the issue? Pick one — we'll review reports within 48 hours.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <button
                  key={r.value}
                  onClick={() => setReason(r.value)}
                  className={
                    "text-start px-4 py-3 rounded-xl border transition " +
                    (selected
                      ? "bg-ink-1 text-surface-0 border-ink-1"
                      : "bg-surface-1 border-line hover:border-ink-2 hover:bg-surface-2")
                  }
                >
                  <div className="text-sm font-semibold">{r.label}</div>
                  <div className={`text-xs mt-0.5 ${selected ? "text-surface-0/75" : "text-ink-3"}`}>
                    {r.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 pb-3">
          <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">
            Anything else? (optional)
          </label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Context that helps us review."
            className="w-full px-3 py-2.5 rounded-lg border border-line bg-surface-1 text-ink-1 text-sm focus:border-accent outline-none resize-none"
          />
        </div>

        <label className="flex items-center gap-3 mx-6 mb-4 px-4 py-3 rounded-xl border border-line bg-surface-2 cursor-pointer hover:bg-surface-3">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(e) => setAlsoBlock(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-[#C23F6C]" /> Also block this person
            </div>
            <div className="text-xs text-ink-3 mt-0.5">
              They'll be hidden from your Discover, Connect, and room lists. You won't see their posts; they won't see yours.
            </div>
          </div>
        </label>

        {err && (
          <div className="mx-6 mb-3 flex items-start gap-2 p-3 rounded-lg bg-[#C23F6C]/10 text-[#C23F6C] text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="flex items-center gap-2 px-6 pb-5 pt-2 border-t border-line bg-surface-2/60">
          <button
            onClick={onClose}
            className="h-11 px-5 rounded-full text-sm font-medium text-ink-2 hover:bg-surface-3"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || (!reason && !alsoBlock)}
            className="flex-1 h-11 rounded-full bg-[#C23F6C] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#a8345a] transition"
          >
            {submitting ? "Submitting…" : reason && alsoBlock ? "Report & block" : reason ? "Submit report" : "Block user"}
          </button>
        </div>
      </Sheet>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report or block user"
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-0 sm:px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-ink-1/55 backdrop-blur-sm" aria-hidden />
      {children}
    </div>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full sm:max-w-[480px] max-h-[92dvh] overflow-y-auto bg-surface-1 sm:rounded-[28px] rounded-t-[28px] border border-line shadow-xl">
      {children}
    </div>
  );
}
