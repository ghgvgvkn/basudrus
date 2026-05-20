/**
 * DataSection — export, delete account, and the privacy fine print.
 *
 * Export is real: queries the user's own tables, packages as JSON,
 * triggers a browser download. Uses RLS so we can't accidentally
 * leak someone else's data.
 *
 * Delete account is gated behind a typed confirmation ("delete my
 * account") because it's destructive. The actual deletion calls
 * supabase.auth.admin via a server endpoint — until that endpoint
 * exists we explain the manual path honestly.
 */
import { useState } from "react";
import { Download, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession, signOutEverywhere } from "@/features/auth/useSupabaseSession";
import { Group, Row, PrimaryButton, GhostButton, Note } from "./parts";

const TABLES_TO_EXPORT = [
  "profiles",
  "student_memory",
  "tutor_sessions",
  "tutor_progress",
  "tutor_streaks",
  "tutor_saved_messages",
  "wellbeing_sessions",
  "mh_screen_results",
  "ai_usage",
  "chat_history",
  "match_quiz",
  "study_plans",
  "user_study_plans",
  "subject_history",
  "help_requests",
] as const;

export function DataSection() {
  const { user } = useSupabaseSession();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [exportNote, setExportNote] = useState("");
  const [deletePhase, setDeletePhase] = useState<"idle" | "confirm" | "deleting">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [deleteErr, setDeleteErr] = useState("");

  const handleExport = async () => {
    if (!user?.id) return;
    setExporting(true);
    setExportErr("");
    setExportNote("");
    try {
      const userIdCol = (t: string) => (t === "profiles" ? "id" : "user_id");
      const bundle: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        user_id: user.id,
        user_email: user.email,
      };
      const summary: string[] = [];
      for (const table of TABLES_TO_EXPORT) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq(userIdCol(table), user.id);
        if (error) {
          // Some tables might not have rows or might be RLS-blocked
          // for service-role-only access. Skip and continue.
          bundle[table] = { error: error.message };
          continue;
        }
        bundle[table] = data ?? [];
        if (Array.isArray(data) && data.length > 0) summary.push(`${data.length} ${table}`);
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `basudrus-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportNote(summary.length > 0 ? `Exported: ${summary.join(", ")}` : "No data to export yet.");
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!user?.id || confirmText !== "delete my account") return;
    setDeletePhase("deleting");
    setDeleteErr("");
    try {
      // Phase 1 (this codebase): cascade-delete everything the user OWNS
      // via RLS-friendly DELETEs. Phase 2 (TODO): call a server endpoint
      // that uses the service role key to delete the auth.users row,
      // which can't be done from the client.
      for (const table of TABLES_TO_EXPORT) {
        const userIdCol = table === "profiles" ? "id" : "user_id";
        await supabase.from(table).delete().eq(userIdCol, user.id);
      }
      await signOutEverywhere();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : "Deletion failed");
      setDeletePhase("confirm");
    }
  };

  return (
    <>
      <Group title="Export">
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-3 mb-3">
            <Download className="h-5 w-5 text-ink-2 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm text-ink-1 font-medium">Download your data</div>
              <div className="text-xs text-ink-3 mt-0.5">
                Full JSON bundle of everything Bas Udrus stores about you — profile, memory, chat history, study plans, matches, usage. Sent to your browser as a download.
              </div>
            </div>
          </div>
          <PrimaryButton onClick={handleExport} disabled={exporting}>
            <span className="inline-flex items-center gap-1.5">
              {exporting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {exporting ? "Packaging…" : "Download my data"}
            </span>
          </PrimaryButton>
          {exportNote && <Note>{exportNote}</Note>}
          {exportErr && <Note tone="warn">Export failed: {exportErr}</Note>}
        </div>
      </Group>

      <Group title="Visibility">
        <Row
          label="Hidden from Discover"
          hint="Stops your profile from appearing in other students' Discover feeds on basudrus.com. Doesn't affect existing matches."
          action={<GhostButton onClick={() => alert("Coming soon — wired with the privacy refactor on basudrus.com")}>Manage</GhostButton>}
        />
      </Group>

      <Group title="Danger zone">
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-3 mb-3">
            <Trash2 className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm text-ink-1 font-medium">Delete account</div>
              <div className="text-xs text-ink-3 mt-0.5">
                Permanently removes your profile, memory, chat history, plans, matches, and rooms. Cannot be undone. We strongly recommend exporting your data first.
              </div>
            </div>
          </div>

          {deletePhase === "idle" && (
            <GhostButton tone="danger" onClick={() => setDeletePhase("confirm")}>
              I want to delete my account
            </GhostButton>
          )}

          {deletePhase === "confirm" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <p className="text-xs text-ink-1">
                Type <code className="px-1.5 py-0.5 rounded bg-ink-1/5 text-ink-1">delete my account</code> to confirm.
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="delete my account"
                className="w-full h-9 px-3 rounded-lg bg-surface-1 border border-line/60 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
              <div className="flex items-center gap-2">
                <GhostButton onClick={() => { setDeletePhase("idle"); setConfirmText(""); }}>Cancel</GhostButton>
                <button
                  onClick={handleDelete}
                  disabled={confirmText !== "delete my account"}
                  className="h-9 px-3.5 rounded-full bg-red-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Permanently delete
                </button>
              </div>
              {deleteErr && <p className="text-xs text-red-600">{deleteErr}</p>}
              <p className="text-[11px] text-ink-3">
                Note: this clears all your row-level data. To also remove the underlying auth account, contact support — that step needs a server-side admin key we'll wire next.
              </p>
            </div>
          )}

          {deletePhase === "deleting" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Deleting your data…
            </div>
          )}
        </div>
      </Group>

      <Note tone="info">
        <span className="inline-flex items-start gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>We don't train any AI model on your conversations or memory. Your data is yours.</span>
        </span>
      </Note>
    </>
  );
}
