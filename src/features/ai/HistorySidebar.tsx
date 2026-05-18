/**
 * HistorySidebar — slide-in panel showing the student's past chats and
 * saved study plans, plus a quick entry into the Memory view. Roughly
 * mirrors ChatGPT's left sidebar but with Bas Udrus styling and the
 * Memory section moved to a deliberate, prominent spot (it's our
 * differentiator vs ChatGPT).
 *
 * Layout, top to bottom:
 *   1. Profile header — avatar, name, uni/major/year
 *   2. Memory shortcut card — "N things the AI remembers · View"
 *   3. Chats — grouped by Today / Yesterday / Last 7 / Earlier
 *   4. Plans — flat list, newest first
 *   5. Footer — Settings + Logout (parent supplies hooks)
 *
 * Behaviour:
 *   - Mobile (<768px): fixed full-height drawer that slides in from
 *     the left, takes ~85% of viewport width, with a dim backdrop
 *     that closes on tap.
 *   - Desktop: same drawer width feels right at ~360px; we don't go
 *     wider because the chat itself needs the real estate.
 *   - Tapping a session calls `onSelectSession(id)` — the parent
 *     (AIScreen) decides whether to load that session inline.
 *   - Tapping a plan calls `onSelectPlan(plan)` — parent renders the
 *     plan in the existing study-plan modal.
 *   - The Memory button opens MemoryModal in place.
 */
import { useState } from "react";
import {
  X, MessageSquare, FileText, Brain, ChevronRight,
  Settings, LogOut, Trash2, Sparkles, Heart,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useAIHistory, type SessionListItem, type StudyPlanListItem } from "./useAIHistory";
import { useStudentMemory } from "./useStudentMemory";
import { MemoryModal } from "./MemoryModal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user taps a past chat. Parent decides to resume
   *  the conversation, switch persona, etc. */
  onSelectSession: (item: SessionListItem) => void;
  /** Called when the user taps a saved plan. Parent typically opens
   *  the study-plan artifact modal pre-loaded with the markdown. */
  onSelectPlan: (item: StudyPlanListItem) => void;
  /** Called when the user taps "Settings" in the footer. */
  onOpenSettings?: () => void;
  /** Called when the user taps "Log out" in the footer. */
  onLogOut?: () => void;
}

export function HistorySidebar({
  open, onClose, onSelectSession, onSelectPlan, onOpenSettings, onLogOut,
}: Props) {
  const { profile } = useApp();
  const { sessionsGrouped, plans, deleteSession, deletePlan, loading } = useAIHistory();
  const { memories } = useStudentMemory();
  const [memoryOpen, setMemoryOpen] = useState(false);

  return (
    <>
      {/* Backdrop — only renders when open. Click closes the drawer. */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={
          "fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm transition-opacity " +
          (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
        }
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="History and account"
        className={
          "fixed left-0 top-0 bottom-0 z-50 w-[85vw] max-w-[360px] bg-bg border-r border-ink/8 flex flex-col transition-transform duration-200 ease-out " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-ink/8">
          <ProfileBlock profile={profile} />
          <button
            onClick={onClose}
            aria-label="Close history"
            className="w-9 h-9 shrink-0 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Memory shortcut */}
          <button
            type="button"
            onClick={() => setMemoryOpen(true)}
            className="w-full text-left rounded-2xl border border-ink/10 hover:border-ink/25 hover:bg-ink/[3%] transition p-3.5 active:scale-[0.99]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#5B4BF5]/12 inline-flex items-center justify-center shrink-0">
                <Brain size={16} className="text-[#5B4BF5]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-ink">
                  {memories.length === 0
                    ? "Teach your AI about you"
                    : `${memories.length} thing${memories.length === 1 ? "" : "s"} the AI remembers`}
                </div>
                <div className="text-[11.5px] text-ink/55 mt-0.5 leading-tight">
                  {memories.length === 0
                    ? "Add or import facts you want him to know"
                    : "View, edit, add new, or import more"}
                </div>
              </div>
              <ChevronRight size={16} className="text-ink/35 shrink-0" />
            </div>
          </button>

          {/* Chats */}
          <SectionHeader icon={MessageSquare} label="Chats" />
          {loading && sessionsGrouped.today.length === 0 && (
            <div className="text-[12px] text-ink/40 px-2 py-2">Loading…</div>
          )}
          <DateGroup label="Today" items={sessionsGrouped.today} onSelect={onSelectSession} onDelete={deleteSession} />
          <DateGroup label="Yesterday" items={sessionsGrouped.yesterday} onSelect={onSelectSession} onDelete={deleteSession} />
          <DateGroup label="Last 7 days" items={sessionsGrouped.lastSeven} onSelect={onSelectSession} onDelete={deleteSession} />
          <DateGroup label="Earlier" items={sessionsGrouped.earlier} onSelect={onSelectSession} onDelete={deleteSession} />
          {!loading
            && sessionsGrouped.today.length === 0
            && sessionsGrouped.yesterday.length === 0
            && sessionsGrouped.lastSeven.length === 0
            && sessionsGrouped.earlier.length === 0 && (
            <EmptyHint icon={Sparkles} text="No chats yet. Start one in the main area." />
          )}

          {/* Plans */}
          <SectionHeader icon={FileText} label="Plans" />
          {plans.length === 0 && (
            <EmptyHint icon={Sparkles} text="Plans you create with Tony Starrk will be saved here." />
          )}
          {plans.map((p) => (
            <PlanRow key={p.id} item={p} onSelect={onSelectPlan} onDelete={deletePlan} />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-ink/8 px-3 py-2 flex items-center justify-between gap-1">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex-1 h-10 rounded-xl inline-flex items-center justify-center gap-2 text-[13px] text-ink hover:bg-ink/5 transition"
            >
              <Settings size={14} /> Settings
            </button>
          )}
          {onLogOut && (
            <button
              onClick={onLogOut}
              className="flex-1 h-10 rounded-xl inline-flex items-center justify-center gap-2 text-[13px] text-ink hover:bg-ink/5 transition"
            >
              <LogOut size={14} /> Log out
            </button>
          )}
        </div>
      </aside>

      {/* Memory modal, mounted alongside so opening it doesn't close the drawer. */}
      <MemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function ProfileBlock({ profile }: { profile: { name?: string | null; uni?: string | null; major?: string | null; year?: string | number | null } | null }) {
  const initial = (profile?.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const yearLabel = profile?.year != null && profile.year !== ""
    ? `Year ${profile.year}`
    : null;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-9 h-9 rounded-full bg-ink text-bg inline-flex items-center justify-center text-[14px] font-bold shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-ink truncate">{profile?.name || "You"}</div>
        <div className="text-[11px] text-ink/55 truncate">
          {[profile?.uni, profile?.major, yearLabel].filter(Boolean).join(" · ") || "Profile incomplete"}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: typeof MessageSquare; label: string }) {
  return (
    <div className="mt-4 mb-1 px-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink/50 font-semibold">
      <Icon size={11} />
      {label}
    </div>
  );
}

function DateGroup({
  label, items, onSelect, onDelete,
}: {
  label: string;
  items: SessionListItem[];
  onSelect: (item: SessionListItem) => void;
  onDelete: (id: string, persona: SessionListItem["persona"]) => Promise<boolean>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="px-2 mb-1 text-[10.5px] uppercase tracking-wider text-ink/40 font-semibold">{label}</div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <SessionRow key={`${item.persona}-${item.id}`} item={item} onSelect={onSelect} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function SessionRow({
  item, onSelect, onDelete,
}: {
  item: SessionListItem;
  onSelect: (item: SessionListItem) => void;
  onDelete: (id: string, persona: SessionListItem["persona"]) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  // Display title comes pre-baked from useAIHistory.
  const title = item.title || "Untitled chat";
  // Persona styling — Tony Starrk is blue-violet (brain), Sherlock is rose
  // (heart). The badge is a small icon chip rather than a colored
  // dot so it's identifiable at a glance even for color-blind users.
  const isSherlock = item.persona === "noor";
  const PersonaIcon = isSherlock ? Heart : Brain;
  const accent = isSherlock ? "#C23F6C" : "#5B4BF5";
  return (
    <div className="group relative rounded-lg hover:bg-ink/5 transition">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="w-full text-left px-2 py-2 rounded-lg"
      >
        <div className="flex items-start gap-2 pr-7">
          <div
            className="w-5 h-5 mt-0.5 shrink-0 rounded-full inline-flex items-center justify-center"
            style={{ background: `${accent}14` }}
            aria-label={isSherlock ? "Sherlock chat" : "Tony Starrk chat"}
          >
            <PersonaIcon size={10} style={{ color: accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-ink leading-snug line-clamp-2">{title}</div>
            <div className="mt-0.5 text-[10.5px] text-ink/45 inline-flex items-center gap-1.5">
              <span className="capitalize">{isSherlock ? "Sherlock" : item.subject}</span>
              {item.message_count > 0 && <><span>·</span><span>{item.message_count} msgs</span></>}
            </div>
          </div>
        </div>
      </button>
      {confirming ? (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1">
          <button
            onClick={async (e) => { e.stopPropagation(); await onDelete(item.id, item.persona); }}
            className="h-6 px-2 rounded-full bg-[#C23F6C] text-white text-[10.5px] font-semibold"
          >Delete</button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
            className="h-6 px-2 rounded-full bg-ink/8 text-ink text-[10.5px]"
          >×</button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          aria-label="Delete chat"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full inline-flex items-center justify-center text-ink/30 hover:text-[#C23F6C] hover:bg-[#C23F6C]/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function PlanRow({
  item, onSelect, onDelete,
}: {
  item: StudyPlanListItem;
  onSelect: (item: StudyPlanListItem) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="group relative rounded-lg hover:bg-ink/5 transition mt-0.5">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="w-full text-left px-2 py-2 rounded-lg"
      >
        <div className="text-[13px] text-ink leading-snug line-clamp-2 pr-7">{item.title}</div>
        <div className="mt-0.5 text-[10.5px] text-ink/45 inline-flex items-center gap-1.5 flex-wrap">
          {item.subjects.length > 0 && <span className="truncate max-w-[140px]">{item.subjects.slice(0, 2).join(", ")}</span>}
          {item.exam_date && <><span>·</span><span>exam {item.exam_date}</span></>}
        </div>
      </button>
      {confirming ? (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1">
          <button
            onClick={async (e) => { e.stopPropagation(); await onDelete(item.id); }}
            className="h-6 px-2 rounded-full bg-[#C23F6C] text-white text-[10.5px] font-semibold"
          >Delete</button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
            className="h-6 px-2 rounded-full bg-ink/8 text-ink text-[10.5px]"
          >×</button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          aria-label="Delete plan"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full inline-flex items-center justify-center text-ink/30 hover:text-[#C23F6C] hover:bg-[#C23F6C]/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function EmptyHint({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) {
  return (
    <div className="mt-1 mb-2 mx-2 px-3 py-2.5 rounded-xl bg-ink/[2%] border border-ink/8 text-[11.5px] text-ink/55 inline-flex items-start gap-1.5 leading-relaxed">
      <Icon size={11} className="mt-0.5 shrink-0 text-ink/35" />
      <span>{text}</span>
    </div>
  );
}
