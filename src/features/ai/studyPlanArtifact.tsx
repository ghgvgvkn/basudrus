/**
 * StudyPlanArtifact — renders the schedule grid AI (Omar) returns
 * when the user asks for a study plan. A structured artifact (not a
 * text reply) so users can scan, export, and eventually drag blocks.
 *
 * Legacy-map: none. New surface. Live port should define a server
 * response contract like:
 *   { kind: "studyPlan", title: string, days: [{ label, blocks:[…] }] }
 * and stream it alongside the assistant's text.
 *
 * This is a display-only component for the bundle. Drag-to-reschedule,
 * export to Google Calendar, and "save this plan" live on the
 * post-bundle backlog.
 */
import type { StudyPlanArtifact as T } from "@/shared/types";
import { Calendar, Download } from "lucide-react";

export function StudyPlanArtifact({ artifact }: { artifact: T }) {
  return (
    <div className="mt-3 rounded-2xl bg-bg border border-ink/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/8">
        <Calendar size={14} className="text-ink/60" />
        <span className="text-sm font-medium text-ink">{artifact.title}</span>
        <button className="ml-auto text-xs text-ink/50 hover:text-ink inline-flex items-center gap-1.5">
          <Download size={12} />
          Export
        </button>
      </div>

      <div className="divide-y divide-ink/6">
        {artifact.days.map((day) => (
          <div key={day.label} className="flex">
            <div className="w-28 shrink-0 px-4 py-3 text-xs uppercase tracking-wider text-ink/50 border-r border-ink/8">
              {day.label}
            </div>
            <div className="flex-1 p-2 flex flex-wrap gap-1.5">
              {day.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({ b }: { b: T["days"][number]["blocks"][number] }) {
  const tone = {
    study: "bg-ink text-bg",
    break: "bg-ink/5 text-ink/60",
    class: "bg-accent/15 text-accent border border-accent/25",
    sleep: "bg-ink/5 text-ink/40 italic",
  }[b.kind];
  return (
    <div className={`px-2.5 py-1.5 rounded-lg text-xs ${tone}`}>
      <div className="font-medium">{b.subject}</div>
      <div className="opacity-70 text-[10px]">{b.start}–{b.end}</div>
    </div>
  );
}
