/**
 * PastPapersScreen — Phase 1 of the Past Papers feature.
 *
 * Tabs: Browse + My Papers + Upload.
 *
 * Phase 1 (this commit): visible foundation. Browse and My Papers
 * just list rows. Upload accepts the file + manual metadata (uni,
 * course, year, semester, exam type) with the legal-agreement
 * checkbox required before submit. NO AI validation yet.
 *
 * Phase 2 (next): AI validation that the upload looks like an exam
 * paper, automatic extraction of professor name + course code +
 * topics, AI-validated university auto-add, professor cache wiring.
 */
import { useMemo, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { FileText, Plus, Search, Trash2, Upload, ExternalLink, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  usePastPapers,
  type ExamType,
  type Semester,
  type PastPaperRow,
} from "./usePastPapers";

type Tab = "browse" | "mine" | "upload";

const SEMESTERS: { value: Semester; label: string }[] = [
  { value: "fall",   label: "Fall" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
];

const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: "midterm",  label: "Midterm" },
  { value: "final",    label: "Final" },
  { value: "quiz",     label: "Quiz" },
  { value: "practice", label: "Practice" },
  { value: "other",    label: "Other" },
];

// Limited universities at launch + "Other" sentinel — matches the
// strategy doc §7.3 (university catalog expansion). The "Other"
// path triggers AI validation in Phase 2; for now we accept any
// free-text uni name so MVP users aren't blocked.
const SEED_UNIS = [
  "Princess Sumaya University",
  "University of Jordan",
  "German Jordanian University",
  "Amman Al-Ahliyya University",
  "Applied Science University",
  "Middle East University",
  "American University of Madaba",
  "Jordan University of Science and Technology",
  "University of Petra",
  "Hashemite University",
  "Al-Hussein Technical University",
  "Al-Balqa Applied University",
];

export function PastPapersScreen() {
  const [tab, setTab] = useState<Tab>("browse");
  const { rows, myRows, loading, error, refresh, upload, remove } = usePastPapers();

  return (
    <>
      <TopBar
        title="Past Papers"
        onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()}
      />
      <div className="max-w-[960px] mx-auto px-4 lg:px-8 py-6 lg:py-8">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h1 className="font-serif italic text-3xl text-ink-1" style={{ letterSpacing: "-0.02em" }}>
            Past Papers
          </h1>
          <p className="text-xs text-ink-3 hidden sm:block">
            Share + browse past exams from your courses
          </p>
        </div>

        {/* Tab bar */}
        <div className="mb-5 inline-flex p-1 bg-surface-2/60 rounded-full border border-line/60">
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
            <Search className="h-3.5 w-3.5" />
            Browse
          </TabButton>
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
            <FileText className="h-3.5 w-3.5" />
            My Papers
            {myRows.length > 0 && (
              <span className="ms-1 text-[10px] px-1.5 py-0.5 rounded-full bg-ink-1/10 text-ink-2">
                {myRows.length}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
            <Plus className="h-3.5 w-3.5" />
            Upload
          </TabButton>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {tab === "browse" && (
          <BrowseTab rows={rows} loading={loading} />
        )}
        {tab === "mine" && (
          <MyPapersTab rows={myRows} loading={loading} onRemove={remove} />
        )}
        {tab === "upload" && (
          <UploadTab
            onUpload={upload}
            onUploaded={() => { setTab("mine"); void refresh(); }}
          />
        )}
      </div>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition " +
        (active
          ? "bg-surface-1 text-ink-1 shadow-sm border border-line/60"
          : "text-ink-3 hover:text-ink-1")
      }
    >
      {children}
    </button>
  );
}

// ── Browse tab ─────────────────────────────────────────────────────

function BrowseTab({ rows, loading }: { rows: PastPaperRow[]; loading: boolean }) {
  const { profile } = useApp();
  const [uniFilter, setUniFilter] = useState<string>(profile?.uni || "");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (uniFilter && r.uni !== uniFilter) return false;
      if (courseFilter && !r.course_name.toLowerCase().includes(courseFilter.toLowerCase())) return false;
      if (q) {
        const haystack = `${r.course_name} ${r.course_code ?? ""} ${r.professor_name ?? ""} ${r.uni}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, uniFilter, courseFilter, query]);

  // Unique unis present in the data, plus the seed list, deduplicated.
  const allUnis = useMemo(() => {
    const set = new Set<string>(SEED_UNIS);
    for (const r of rows) set.add(r.uni);
    return Array.from(set).sort();
  }, [rows]);

  return (
    <>
      <div className="mb-4 grid sm:grid-cols-[2fr_1fr_2fr] gap-2">
        <select
          value={uniFilter}
          onChange={(e) => setUniFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">🏫 All universities</option>
          {allUnis.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <input
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          placeholder="📚 Course name"
          className="h-10 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search (professor, code, topic…)"
          className="h-10 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {loading ? (
        <div className="grid place-items-center py-16 text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6 text-ink-3" />}
          title="No past papers here yet"
          body={
            rows.length === 0
              ? "Be the first to share a past paper for your course. Anything you upload helps every classmate after you."
              : "No papers match those filters. Try clearing them, or upload one yourself."
          }
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => <PaperRow key={p.id} p={p} />)}
        </ul>
      )}
    </>
  );
}

function PaperRow({ p }: { p: PastPaperRow }) {
  const semLabel = p.semester ? p.semester[0].toUpperCase() + p.semester.slice(1) : null;
  const examLabel = p.exam_type ? p.exam_type[0].toUpperCase() + p.exam_type.slice(1) : null;
  const sub = [
    p.uni,
    p.course_code,
    examLabel,
    semLabel && p.year ? `${semLabel} ${p.year}` : (semLabel || (p.year ? String(p.year) : null)),
    p.professor_name ? `Prof. ${p.professor_name}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="bu-card flex items-center gap-3 px-4 py-3">
      <div className="h-10 w-10 grid place-items-center rounded-xl bg-accent/10 text-accent shrink-0">
        <FileText className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-1 truncate">{p.course_name}</div>
        <div className="text-xs text-ink-3 truncate">{sub}</div>
      </div>
      {p.file_url && (
        <a
          href={p.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-2 hover:bg-surface-3 text-xs text-ink-1 transition"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

// ── My Papers tab ──────────────────────────────────────────────────

function MyPapersTab({
  rows, loading, onRemove,
}: {
  rows: PastPaperRow[];
  loading: boolean;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Upload className="h-6 w-6 text-ink-3" />}
        title="You haven't uploaded any past papers yet"
        body="Sharing a past paper helps every classmate preparing for the same exam. We never republish your upload verbatim — Tony Starrk learns the patterns and refers back to the original."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((p) => (
        <li key={p.id} className="bu-card flex items-center gap-3 px-4 py-3">
          <div className="h-10 w-10 grid place-items-center rounded-xl bg-accent/10 text-accent shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-1 truncate">{p.course_name}</div>
            <div className="text-xs text-ink-3 truncate">
              {[p.uni, p.exam_type, p.semester, p.year].filter(Boolean).join(" · ")}
            </div>
          </div>
          {p.file_url && (
            <a
              href={p.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-2 hover:bg-surface-3 text-xs text-ink-1 transition"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {confirmId === p.id ? (
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() => setConfirmId(null)}
                disabled={removing}
                className="h-8 px-3 rounded-full text-xs text-ink-2 hover:bg-surface-2"
              >Cancel</button>
              <button
                onClick={async () => {
                  setRemoving(true);
                  try { await onRemove(p.id); } finally { setRemoving(false); setConfirmId(null); }
                }}
                disabled={removing}
                className="h-8 px-3 rounded-full bg-red-500 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                {removing && <Loader2 className="h-3 w-3 animate-spin" />}
                {removing ? "Deleting…" : "Delete"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(p.id)}
              className="shrink-0 h-8 w-8 grid place-items-center rounded-full text-ink-3 hover:text-red-600 hover:bg-red-500/10"
              aria-label="Delete this paper"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Upload tab ─────────────────────────────────────────────────────

function UploadTab({
  onUpload, onUploaded,
}: {
  onUpload: (input: import("./usePastPapers").UploadInput) => Promise<import("./usePastPapers").UploadResult>;
  onUploaded: () => void;
}) {
  const { profile } = useApp();
  const [uni, setUni] = useState<string>(profile?.uni || "");
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [professorName, setProfessorName] = useState("");
  const [examType, setExamType] = useState<ExamType>("final");
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [semester, setSemester] = useState<Semester>("fall");
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canSubmit = !!file && !!uni.trim() && !!courseName.trim() && agreed && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setBusy(true);
    setResult(null);
    const out = await onUpload({
      uni,
      courseName,
      courseCode: courseCode || null,
      professorName: professorName || null,
      examType,
      year,
      semester,
      file,
      rightToShareAgreed: agreed,
    });
    setBusy(false);
    if (out.ok) {
      setResult({ ok: true, message: "Uploaded ✓ — appears in My Papers" });
      // Reset form for the next upload
      setFile(null);
      setCourseName("");
      setCourseCode("");
      setProfessorName("");
      setAgreed(false);
      // Bounce to My Papers after a beat so the user sees confirmation
      setTimeout(() => onUploaded(), 900);
    } else {
      setResult({ ok: false, message: out.error || "Upload failed." });
    }
  };

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 12; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bu-card p-4 sm:p-5 space-y-4">
        <FieldLabel label="University">
          <select
            value={uni}
            onChange={(e) => setUni(e.target.value)}
            required
            className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">Pick your university</option>
            {SEED_UNIS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
            {uni && !SEED_UNIS.includes(uni) && (
              <option value={uni}>{uni}</option>
            )}
          </select>
        </FieldLabel>

        <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
          <FieldLabel label="Course name">
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              required
              placeholder="e.g. Operating Systems"
              className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </FieldLabel>
          <FieldLabel label="Course code (optional)">
            <input
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              placeholder="e.g. CS340"
              className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Professor name (optional)">
          <input
            value={professorName}
            onChange={(e) => setProfessorName(e.target.value)}
            placeholder="e.g. Dr. Ahmad Hamdan"
            className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </FieldLabel>

        <div className="grid sm:grid-cols-3 gap-3">
          <FieldLabel label="Exam type">
            <select
              value={examType}
              onChange={(e) => setExamType(e.target.value as ExamType)}
              className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {EXAM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Semester">
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value as Semester)}
              className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {SEMESTERS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Year">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </FieldLabel>
        </div>

        <FieldLabel label="File (PDF or photos)">
          <label className="block w-full p-4 border-2 border-dashed border-line rounded-xl bg-surface-2/40 hover:bg-surface-2 cursor-pointer transition">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 grid place-items-center rounded-lg bg-surface-1 text-ink-2 shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                {file ? (
                  <>
                    <div className="text-sm text-ink-1 font-medium truncate">{file.name}</div>
                    <div className="text-xs text-ink-3">{(file.size / 1024).toFixed(0)} KB · click to change</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-ink-1">Click to choose a file</div>
                    <div className="text-xs text-ink-3">PDF or photos · max 10 MB</div>
                  </>
                )}
              </div>
            </div>
          </label>
        </FieldLabel>

        <label className="flex items-start gap-2.5 text-xs text-ink-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line/60 text-accent focus:ring-accent/30"
          />
          <span>
            <strong className="text-ink-1">I confirm I have the right to share this material.</strong> Bas Udrus stores
            this paper in a shared library that other students at this university may view. We
            never republish exam questions verbatim — Tony Starrk learns the patterns and refers
            students back to the original.
          </span>
        </label>
      </div>

      {result && (
        <div
          className={
            "flex items-start gap-2 p-3 rounded-xl text-sm " +
            (result.ok
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-red-500/10 text-red-700 dark:text-red-300")
          }
        >
          {result.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-11 px-5 rounded-full bg-ink-1 text-surface-1 text-sm font-medium hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Uploading…" : "Upload past paper"}
        </button>
      </div>

      <p className="text-[11px] text-ink-3 leading-relaxed">
        Phase 2 will add AI validation that automatically extracts the professor name, exam type, year, and topics from your upload — and verifies the file actually looks like a past paper. For now, fill in what you know above.
      </p>
    </form>
  );
}

// ── Shared bits ────────────────────────────────────────────────────

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-ink-3 mb-1.5 font-medium uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({
  icon, title, body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto mb-3 h-12 w-12 grid place-items-center rounded-2xl bg-surface-2/60">
        {icon}
      </div>
      <div className="text-sm font-medium text-ink-1 mb-1">{title}</div>
      <div className="text-xs text-ink-3 max-w-md mx-auto leading-relaxed">{body}</div>
    </div>
  );
}
