/**
 * MemoryModal — full-screen modal where the student sees, edits, deletes,
 * adds, and imports the facts Omar / Noor remember about them.
 *
 * Three internal tabs:
 *   1. "What Omar knows" — list of current memories, grouped by category,
 *      each with edit + delete affordances.
 *   2. "Add a memory" — single text field + category + importance.
 *      Used when the student wants to teach Omar something explicitly
 *      ("I commute 1 hour every morning so my study window is 6pm-10pm").
 *   3. "Import from another AI" — shows the copy-paste prompt template
 *      with a "Copy" button, then a textarea where the student pastes
 *      the JSON output back. We parse, validate, preview, and insert.
 *
 * Design principles:
 *   - Trust the student. Delete is one tap (with an undo toast only —
 *     no scary confirm modal). Memory is theirs.
 *   - The Import flow is the headline feature here. Make it obvious
 *     and frictionless: copy → paste → review → save.
 *   - Empty states should encourage adding memories, not feel sterile.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  X, Plus, Trash2, ArrowLeft, Copy, Check, Upload, Search,
  BookOpen, Heart, MapPin, AlertTriangle, Star, Target, Trophy, Hash,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import {
  useStudentMemory, parseImportPayload, buildImportPrompt,
  type MemoryCategory, type StudentMemoryRow, type ParsedImportEntry,
} from "./useStudentMemory";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "list" | "add" | "import";

const CATEGORY_META: Record<MemoryCategory, { label: string; Icon: typeof BookOpen; color: string }> = {
  academic:   { label: "Academic",   Icon: BookOpen,        color: "#5B4BF5" },
  preference: { label: "Preference", Icon: Heart,           color: "#C23F6C" },
  context:    { label: "Context",    Icon: MapPin,          color: "#0E8A6B" },
  weakness:   { label: "Weak area",  Icon: AlertTriangle,   color: "#E8743B" },
  strength:   { label: "Strength",   Icon: Star,            color: "#D4A017" },
  goal:       { label: "Goal",       Icon: Target,          color: "#4B6EF5" },
  win:        { label: "Win",        Icon: Trophy,          color: "#0E8A6B" },
  other:      { label: "Other",      Icon: Hash,            color: "#5C5C5C" },
};

export function MemoryModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("list");
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] bg-bg flex flex-col">
      <Header
        phase={phase}
        onBack={phase === "list" ? null : () => setPhase("list")}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto">
        {phase === "list" && <ListPhase onAdd={() => setPhase("add")} onImport={() => setPhase("import")} />}
        {phase === "add" && <AddPhase onDone={() => setPhase("list")} />}
        {phase === "import" && <ImportPhase onDone={() => setPhase("list")} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared header
// ─────────────────────────────────────────────────────────────────────

function Header({ phase, onBack, onClose }: { phase: Phase; onBack: (() => void) | null; onClose: () => void }) {
  // Title: "AI memory" rather than "What Omar remembers" because the
  // memory is shared across Omar (tutor) AND Noor (wellbeing) — one
  // memory layer, both personas read from it. Calling it "Omar's"
  // memory misrepresented that.
  const title = phase === "list" ? "AI memory" : phase === "add" ? "Add a memory" : "Import from another AI";
  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink/8 bg-bg/95 backdrop-blur">
      <div className="inline-flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="text-[13.5px] font-semibold text-ink">{title}</div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="w-9 h-9 rounded-full inline-flex items-center justify-center text-ink/55 hover:text-ink hover:bg-ink/5 transition"
      >
        <X size={18} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1 — list of current memories
// ─────────────────────────────────────────────────────────────────────

function ListPhase({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const { memories, loading, remove } = useStudentMemory();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter((m) =>
      m.fact.toLowerCase().includes(q) || m.category.toLowerCase().includes(q),
    );
  }, [memories, query]);

  const grouped = useMemo(() => {
    const out: Partial<Record<MemoryCategory, StudentMemoryRow[]>> = {};
    for (const m of filtered) {
      (out[m.category] = out[m.category] ?? []).push(m);
    }
    return out;
  }, [filtered]);

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6">
      <p className="text-[13.5px] text-ink/65 leading-relaxed">
        These are the things your AI (Omar and Noor) remembers about you across every session. You can delete anything, add new memories yourself, or import facts from another AI to bootstrap.
      </p>

      {/* Action row */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ink text-bg text-[13px] font-medium active:scale-[0.98] transition"
        >
          <Plus size={14} /> Add memory
        </button>
        <button
          onClick={onImport}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ink/15 hover:border-ink/30 hover:bg-ink/[3%] text-ink text-[13px] font-medium transition"
        >
          <Upload size={14} /> Import from another AI
        </button>
      </div>

      {/* Search */}
      {memories.length > 4 && (
        <div className="mt-4 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories"
            className="w-full h-9 pl-9 pr-3 rounded-full bg-ink/5 border border-ink/8 focus:border-ink/25 focus:bg-bg text-[13px] text-ink outline-none transition"
          />
        </div>
      )}

      {/* List */}
      {loading && memories.length === 0 && (
        <div className="mt-8 text-[13px] text-ink/45 text-center">Loading…</div>
      )}
      {!loading && memories.length === 0 && (
        <EmptyState onAdd={onAdd} onImport={onImport} />
      )}
      {!loading && filtered.length === 0 && memories.length > 0 && (
        <div className="mt-8 text-[13px] text-ink/45 text-center">No memories match that search.</div>
      )}
      <div className="mt-6 space-y-6">
        {(Object.entries(grouped) as Array<[MemoryCategory, StudentMemoryRow[]]>).map(([cat, rows]) => (
          <CategoryGroup key={cat} category={cat} rows={rows} onDelete={remove} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="mt-12 rounded-2xl bg-ink/3 border border-ink/8 p-6 text-center">
      <div className="text-[14.5px] font-semibold text-ink">Your AI doesn't know anything about you yet.</div>
      <p className="mt-2 text-[13px] text-ink/65 leading-relaxed">
        Memories build naturally as you chat with Omar and Noor. You can also seed them — add what you'd want your AI to know, or import facts from another AI you've been using.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ink text-bg text-[13px] font-medium">
          <Plus size={14} /> Add the first one
        </button>
        <button onClick={onImport} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ink/15 text-ink text-[13px] font-medium">
          <Upload size={14} /> Import
        </button>
      </div>
    </div>
  );
}

function CategoryGroup({
  category, rows, onDelete,
}: {
  category: MemoryCategory;
  rows: StudentMemoryRow[];
  onDelete: (id: string) => Promise<boolean>;
}) {
  const meta = CATEGORY_META[category];
  return (
    <section>
      <div className="inline-flex items-center gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/55 font-semibold mb-2">
        <meta.Icon size={11} style={{ color: meta.color }} />
        {meta.label} · {rows.length}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <MemoryRow key={row.id} row={row} onDelete={onDelete} />
        ))}
      </div>
    </section>
  );
}

function MemoryRow({ row, onDelete }: { row: StudentMemoryRow; onDelete: (id: string) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="rounded-xl border border-ink/10 p-3 hover:border-ink/25 transition group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] text-ink leading-relaxed break-words">{row.fact}</p>
          <div className="mt-1.5 text-[11px] text-ink/45 inline-flex items-center gap-2">
            <span>importance {row.importance}/10</span>
            <span>·</span>
            <span className="capitalize">{row.source.replace("_", " ")}</span>
          </div>
        </div>
        {confirming ? (
          <div className="shrink-0 inline-flex items-center gap-1">
            <button
              onClick={async () => { await onDelete(row.id); }}
              className="h-7 px-2 rounded-full bg-[#C23F6C] text-white text-[11px] font-semibold"
            >Delete</button>
            <button
              onClick={() => setConfirming(false)}
              className="h-7 px-2 rounded-full bg-ink/5 text-ink text-[11px] font-medium"
            >Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            aria-label="Delete memory"
            className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-ink/40 hover:text-[#C23F6C] hover:bg-[#C23F6C]/8 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — add a single memory manually
// ─────────────────────────────────────────────────────────────────────

function AddPhase({ onDone }: { onDone: () => void }) {
  const { add } = useStudentMemory();
  const [fact, setFact] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("context");
  const [importance, setImportance] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    const res = await add({ fact, category, importance, source: "manual" });
    setSubmitting(false);
    if (res.ok) onDone();
    else setError(res.error ?? "Couldn't save");
  };

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6">
      <Field label="What should Omar remember?">
        <textarea
          value={fact}
          onChange={(e) => setFact(e.target.value)}
          placeholder='Example: "I commute 1 hour every morning so my real study window is 6pm–10pm on weekdays."'
          rows={4}
          maxLength={600}
          className="w-full p-3 rounded-xl border border-ink/12 focus:border-ink/30 focus:bg-bg bg-ink/[2%] text-[14px] text-ink outline-none resize-none leading-relaxed"
        />
        <div className="mt-1 text-[11px] text-ink/40 text-right tabular-nums">{fact.trim().length} / 600</div>
      </Field>

      <Field label="Category">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_META) as MemoryCategory[]).map((c) => {
            const meta = CATEGORY_META[c];
            const active = c === category;
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium transition " +
                  (active ? "bg-ink text-bg" : "bg-ink/5 text-ink/75 hover:bg-ink/10")
                }
              >
                <meta.Icon size={11} /> {meta.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={`Importance: ${importance} / 10`}>
        <input
          type="range"
          min={1}
          max={10}
          value={importance}
          onChange={(e) => setImportance(Number(e.target.value))}
          className="w-full"
          aria-label="Importance"
        />
        <div className="flex justify-between text-[10.5px] text-ink/40">
          <span>Trivia</span><span>Medium</span><span>Critical</span>
        </div>
      </Field>

      {error && (
        <div className="mt-3 rounded-xl border border-[#C23F6C]/30 bg-[#C23F6C]/8 px-3 py-2 text-[12.5px] text-[#C23F6C]">
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={fact.trim().length < 4 || submitting}
        className="mt-6 w-full h-11 rounded-full bg-ink text-bg font-medium text-[14px] disabled:opacity-40 active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
      >
        {submitting ? "Saving…" : <><Check size={16} /> Save memory</>}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[12px] font-semibold text-ink/65 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — import from another AI
// ─────────────────────────────────────────────────────────────────────

function ImportPhase({ onDone }: { onDone: () => void }) {
  const { profile } = useApp();
  const { addMany } = useStudentMemory();
  const promptText = useMemo(() => buildImportPrompt({ studentName: profile?.name ?? undefined }), [profile?.name]);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<ParsedImportEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [insertedCount, setInsertedCount] = useState<number | null>(null);

  const onCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const onPreview = () => {
    setError(null);
    const parsed = parseImportPayload(pasted);
    if (!parsed) {
      setError("I couldn't find a valid JSON array in what you pasted. Make sure the other AI's response starts with `[` and ends with `]`.");
      setPreview(null);
      return;
    }
    setPreview(parsed);
  };

  const onConfirm = async () => {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    const res = await addMany(preview.map((p) => ({
      fact: p.fact, category: p.category, importance: p.importance,
    })), "imported");
    setSubmitting(false);
    if (!res.ok) { setError(res.error ?? "Couldn't save."); return; }
    setInsertedCount(res.inserted);
    setTimeout(() => onDone(), 1200);
  };

  return (
    <div className="max-w-xl mx-auto px-5 md:px-6 py-6">
      {/* Step 1 — copy prompt */}
      <Step n={1} title="Copy this prompt">
        <p className="text-[13px] text-ink/65 leading-relaxed">
          Open the other AI (ChatGPT, Claude, anything), paste the prompt below into a conversation where you've been talking for a while. The AI will return a JSON list of facts about you.
        </p>
        <div className="mt-3 rounded-xl bg-ink/[3%] border border-ink/10 p-3 max-h-48 overflow-y-auto">
          <pre className="text-[11.5px] font-mono whitespace-pre-wrap text-ink/85 leading-relaxed">{promptText}</pre>
        </div>
        <button
          onClick={onCopyPrompt}
          className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ink text-bg text-[13px] font-medium"
        >
          {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy prompt</>}
        </button>
      </Step>

      {/* Step 2 — paste response */}
      <Step n={2} title="Paste the response here">
        <textarea
          value={pasted}
          onChange={(e) => { setPasted(e.target.value); setPreview(null); }}
          placeholder='[{"fact": "Ahmed is a CS student at PSUT", "category": "academic", "importance": 9}, ...]'
          rows={8}
          className="w-full p-3 rounded-xl border border-ink/12 focus:border-ink/30 focus:bg-bg bg-ink/[2%] text-[12.5px] font-mono text-ink outline-none resize-y leading-relaxed"
        />
        <button
          onClick={onPreview}
          disabled={pasted.trim().length < 4}
          className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ink/15 hover:border-ink/30 text-ink text-[13px] font-medium disabled:opacity-40"
        >
          Preview
        </button>
        {error && (
          <div className="mt-3 rounded-xl border border-[#C23F6C]/30 bg-[#C23F6C]/8 px-3 py-2 text-[12.5px] text-[#C23F6C]">
            {error}
          </div>
        )}
      </Step>

      {/* Step 3 — review + confirm */}
      {preview && (
        <Step n={3} title={`Review ${preview.length} memor${preview.length === 1 ? "y" : "ies"}`}>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {preview.map((entry, i) => {
              const meta = CATEGORY_META[entry.category];
              return (
                <div key={i} className="rounded-lg border border-ink/8 p-2.5 text-[12.5px] text-ink leading-relaxed">
                  <div className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
                    <meta.Icon size={10} /> {meta.label} · {entry.importance}/10
                  </div>
                  <div className="mt-0.5">{entry.fact}</div>
                </div>
              );
            })}
          </div>
          {insertedCount !== null ? (
            <div className="mt-4 text-[13px] text-[#0E8A6B] font-semibold inline-flex items-center gap-1.5">
              <Check size={14} /> Imported {insertedCount} memories.
            </div>
          ) : (
            <button
              onClick={onConfirm}
              disabled={submitting}
              className="mt-4 w-full h-11 rounded-full bg-ink text-bg font-medium text-[14px] disabled:opacity-40 active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
            >
              {submitting ? "Importing…" : <><Check size={16} /> Save all to memory</>}
            </button>
          )}
        </Step>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-ink mb-2">
        <span className="w-6 h-6 rounded-full bg-ink text-bg inline-flex items-center justify-center text-[11.5px] font-bold">{n}</span>
        {title}
      </div>
      {children}
    </section>
  );
}
