/**
 * MemorySection — list, edit, add, delete the facts Tony Starrk remembers.
 *
 * Reuses the existing useStudentMemory hook from @/features/ai/ —
 * which is the same source of truth basudrus.com reads from, so a
 * fact added here is instantly visible to Tony on the main site too.
 *
 * Falls back to launching the full-screen MemoryModal (with its
 * add/import phases) for editing flows that don't fit inside the
 * Settings card.
 */
import { useState } from "react";
import { Brain, Plus, Trash2, Sparkles, Upload, Loader2 } from "lucide-react";
import { useStudentMemory, type MemoryCategory, type StudentMemoryRow } from "@/features/ai/useStudentMemory";
import { MemoryModal } from "@/features/ai/MemoryModal";
import { Group, Note, PrimaryButton, GhostButton, Tag } from "./parts";

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  academic:   "Academic",
  preference: "Preferences",
  context:    "Context",
  weakness:   "Weak spots",
  strength:   "Strengths",
  goal:       "Goals",
  win:        "Wins",
  other:      "Other",
};

export function MemorySection() {
  const { memories, loading, error, refresh, remove } = useStudentMemory();
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await remove(id); } finally { setDeletingId(null); }
  };

  // Group facts by category for legibility
  const grouped: Record<string, StudentMemoryRow[]> = {};
  for (const row of memories) {
    const cat = (row.category as MemoryCategory) || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }
  const categories = Object.keys(grouped).sort();

  return (
    <>
      <Group title="Overview">
        <div className="px-4 py-3.5 flex items-center gap-3">
          <Brain className="h-5 w-5 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink-1 font-medium">
              {memories.length} {memories.length === 1 ? "fact" : "facts"} stored
            </div>
            <div className="text-xs text-ink-3 mt-0.5">
              Tony Starrk and Sherlock pull the most relevant facts into context for every conversation.
            </div>
          </div>
        </div>
      </Group>

      <Group
        title="Manage"
        hint={loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : null}
      >
        <div className="px-4 py-3 flex gap-2 flex-wrap">
          <PrimaryButton onClick={() => setShowModal(true)}>
            <span className="inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add a fact</span>
          </PrimaryButton>
          <GhostButton onClick={() => setShowModal(true)}>
            <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Import from another AI</span>
          </GhostButton>
          <GhostButton onClick={refresh} disabled={loading}>Refresh</GhostButton>
        </div>
      </Group>

      {error && <Note tone="warn">Couldn't load memory: {error}</Note>}

      {!loading && memories.length === 0 && (
        <Group title="Stored facts">
          <div className="px-4 py-8 text-center">
            <Sparkles className="h-6 w-6 text-ink-3 mx-auto mb-2" />
            <div className="text-sm text-ink-1 font-medium mb-1">No memory yet</div>
            <div className="text-xs text-ink-3 mb-4 max-w-sm mx-auto">
              Add a fact like "I'm preparing for my OS midterm on June 12" so Tony can pick up where you left off next time.
            </div>
            <PrimaryButton onClick={() => setShowModal(true)}>Add your first fact</PrimaryButton>
          </div>
        </Group>
      )}

      {categories.map((cat) => {
        const items = grouped[cat] ?? [];
        if (items.length === 0) return null;
        const label = CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] || cat;
        return (
          <Group key={cat} title={label} hint={`${items.length}`}>
            {items.map((row) => (
              <div key={row.id} className="px-4 py-3 flex items-start gap-3 group">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-1 leading-snug">{row.fact}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {row.source && row.source !== "manual" && (
                      <Tag tone="neutral">
                        {row.source === "auto_extracted" ? "Auto-extracted" : "Imported"}
                      </Tag>
                    )}
                    {typeof row.importance === "number" && row.importance >= 4 && (
                      <Tag tone="accent">Important</Tag>
                    )}
                    {row.last_referenced && (
                      <span className="text-[11px] text-ink-3">
                        Last referenced {formatDate(row.last_referenced)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(row.id)}
                  disabled={deletingId === row.id}
                  className="
                    shrink-0 h-8 w-8 grid place-items-center rounded-lg
                    text-ink-3 hover:text-red-600 hover:bg-red-500/10
                    transition opacity-0 group-hover:opacity-100
                    disabled:opacity-100 disabled:cursor-not-allowed
                  "
                  aria-label="Delete this fact"
                >
                  {deletingId === row.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </Group>
        );
      })}

      <Note tone="info">
        Memory is per-user and shared between basudrus.com and ai.basudrus.com. We never share any of your facts with other users or train models on them.
      </Note>

      {/* Full-screen modal for add/import flows */}
      <MemoryModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}
