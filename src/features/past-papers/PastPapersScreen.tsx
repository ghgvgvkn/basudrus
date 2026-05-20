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
import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { FileText, Plus, Search, Trash2, Upload, ExternalLink, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useCourseSearch } from "@/features/discover/useCourseSearch";
import {
  usePastPapers,
  analyzePastPaper,
  type ExamType,
  type Semester,
  type PastPaperRow,
} from "./usePastPapers";
import { Sparkles } from "lucide-react";

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
  const { rows, myRows, loading, error, refresh, upload, remove, setShared } = usePastPapers();

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
          <MyPapersTab rows={myRows} loading={loading} onRemove={remove} onSetShared={setShared} />
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
  rows, loading, onRemove, onSetShared,
}: {
  rows: PastPaperRow[];
  loading: boolean;
  onRemove: (id: string) => Promise<boolean>;
  onSetShared: (id: string, shared: boolean) => Promise<boolean>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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
            <div className="text-sm font-medium text-ink-1 truncate inline-flex items-center gap-2">
              {p.course_name}
              <span
                className={
                  "text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full " +
                  (p.shared
                    ? "bg-accent/10 text-accent"
                    : "bg-ink-1/5 text-ink-3")
                }
              >
                {p.shared ? "Shared" : "Private"}
              </span>
            </div>
            <div className="text-xs text-ink-3 truncate">
              {[p.uni, p.exam_type, p.semester, p.year].filter(Boolean).join(" · ")}
            </div>
          </div>
          {/* Share toggle — flips past_papers.shared and seeds the
              professors cache the first time it turns ON. */}
          <button
            type="button"
            onClick={async () => {
              setTogglingId(p.id);
              try { await onSetShared(p.id, !p.shared); } finally { setTogglingId(null); }
            }}
            disabled={togglingId === p.id}
            title={p.shared ? "Make private" : "Share with classmates"}
            className={
              "shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition disabled:opacity-50 " +
              (p.shared
                ? "bg-accent/10 text-accent hover:bg-accent/15"
                : "bg-surface-2 text-ink-2 hover:bg-surface-3")
            }
          >
            {togglingId === p.id
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : (p.shared ? "Unshare" : "Share")}
          </button>
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
  // Default OFF per the strategy doc §7.2 #3 — uploads are private
  // until the contributor explicitly opts to share.
  const [shareWithClassmates, setShareWithClassmates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // AI-analyzer state (Phase 2b). Runs against Claude Sonnet to
  // (a) verify the file actually looks like an exam paper and
  // (b) pre-fill metadata fields. Always optional — the user can
  // skip and submit manually.
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<import("./usePastPapers").AnalyzeOutput | null>(null);
  // Resets whenever the file changes — stale analysis would confuse
  // (e.g. user picks file A, runs analyze, then swaps to file B).
  useEffect(() => { setAnalysis(null); }, [file?.name, file?.size]);

  const runAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const hint = [uni && `University: ${uni}`, courseName && `Course: ${courseName}`].filter(Boolean).join(" · ");
      const out = await analyzePastPaper({ file, hint });
      setAnalysis(out);
      // Pre-fill any field the user hasn't already typed. Don't
      // overwrite — they may have entered something more accurate.
      if (out.ok) {
        const ex = out.extracted;
        if (ex.courseName && !courseName.trim())       setCourseName(ex.courseName);
        if (ex.courseCode && !courseCode.trim())       setCourseCode(ex.courseCode);
        if (ex.professorName && !professorName.trim()) setProfessorName(ex.professorName);
        if (ex.year)                                    setYear(ex.year);
        if (ex.semester)                                setSemester(ex.semester);
        if (ex.examType)                                setExamType(ex.examType);
      }
    } finally {
      setAnalyzing(false);
    }
  };

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
      shareWithClassmates,
      // AI-extracted topics carry through to past_papers.topics_covered
      // AND, when sharing is on, into the professors cache so Tony's
      // DATABASE CONTEXT block picks them up.
      topicsCovered: analysis?.extracted.topicsCovered ?? [],
    });
    setBusy(false);
    if (out.ok) {
      setResult({
        ok: true,
        message: shareWithClassmates
          ? "Uploaded ✓ — shared with your course"
          : "Uploaded ✓ — saved to your private locker (you can share it later)",
      });
      // Reset form for the next upload
      setFile(null);
      setCourseName("");
      setCourseCode("");
      setProfessorName("");
      setAgreed(false);
      setShareWithClassmates(false);
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
          <UniversityField
            value={uni}
            onChange={setUni}
            placeholder="Type your university (any in the world)"
          />
        </FieldLabel>

        <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
          <FieldLabel label="Course">
            <CourseField
              value={courseName}
              onChange={setCourseName}
              placeholder="Search 5,770 courses — Operating Systems, Calculus, Anatomy…"
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

        {/* AI analyzer — verifies the file is a past paper + pre-fills
            metadata. Optional; the user can still submit manually. */}
        {file && (
          <div className="rounded-xl bg-accent/5 border border-accent/20 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={runAnalyze}
                disabled={analyzing}
                className="h-9 px-3.5 rounded-full bg-ink-1 text-surface-1 text-sm font-medium hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-1.5"
              >
                {analyzing
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
                  : <><Sparkles className="h-3.5 w-3.5" /> {analysis ? "Re-analyze" : "Analyze with AI"}</>}
              </button>
              <span className="text-[11px] text-ink-3">
                Optional — Tony reads the file and auto-fills the fields below.
              </span>
            </div>

            {analysis && (
              <div className="text-xs leading-relaxed">
                {analysis.error ? (
                  <div className="text-red-700 dark:text-red-300">
                    Analysis failed: {analysis.error}
                  </div>
                ) : analysis.isPastPaper ? (
                  <div className="text-emerald-800 dark:text-emerald-300">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Looks like a past paper
                      <span className="text-ink-3 font-normal">
                        (confidence {Math.round(analysis.confidence * 100)}%)
                      </span>
                    </span>
                    <div className="text-ink-2 mt-1">{analysis.reasoning}</div>
                    {analysis.extracted.topicsCovered.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {analysis.extracted.topicsCovered.map((t, i) => (
                          <span key={i} className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-amber-800 dark:text-amber-300">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5" /> This doesn't look like a past paper
                    </span>
                    <div className="text-ink-2 mt-1">{analysis.reasoning}</div>
                    <div className="text-ink-3 mt-1.5">
                      You can still upload it, but if it's not actually an exam paper, please pick a different file.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Share toggle — strategy doc §7.2 #3: PRIVATE by default. */}
        <div className="rounded-xl border border-line/60 bg-surface-2/40 p-3 flex items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={shareWithClassmates}
            onClick={() => setShareWithClassmates((v) => !v)}
            className={`mt-0.5 relative h-6 w-10 rounded-full transition-colors shrink-0 ${shareWithClassmates ? "bg-accent" : "bg-surface-3"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${shareWithClassmates ? "start-[18px]" : "start-0.5"}`} />
          </button>
          <div className="flex-1 min-w-0 text-xs">
            <div className="text-sm font-medium text-ink-1 mb-0.5">
              Share with my course's students
            </div>
            <div className="text-ink-3 leading-relaxed">
              {shareWithClassmates
                ? `Visible to other ${uni || "students"} taking ${courseName || "this course"}. Tony Starrk will fold the patterns (year, topics, professor) into his knowledge so the next student preparing for this exam benefits too.`
                : "Default OFF. Your paper stays in your private locker — only you can see it. Turn this on whenever you're ready to help your classmates."}
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-ink-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line/60 text-accent focus:ring-accent/30"
          />
          <span>
            <strong className="text-ink-1">I confirm I have the right to share this material.</strong> Whether you keep it private or share it, we
            never republish exam questions verbatim — Tony Starrk learns the patterns and refers
            students back to the original. By submitting you confirm you're allowed to upload this file.
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
        Tip: hit "Analyze with AI" after picking a file — Tony reads it and pre-fills the professor name, year, semester, exam type, and topics. You can edit anything before submitting.
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

// ── Field components ──────────────────────────────────────────────

/**
 * UniversityField — free-text input accepting ANY university in the
 * world. Suggests common Jordanian unis as you type for quick
 * selection, but doesn't restrict to them. Phase 2b will run AI
 * validation server-side to confirm new uni names are real
 * institutions before they're inserted into `public.universities`.
 */
function UniversityField({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click — same pattern used in the Discover
  // course filter. Clicks inside the wrap (including the dropdown)
  // don't close it.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return SEED_UNIS.slice(0, 6);
    return SEED_UNIS.filter((u) => u.toLowerCase().includes(q)).slice(0, 8);
  }, [value]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        required
        className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-[280px] overflow-y-auto rounded-xl border border-line/60 bg-surface-1 shadow-lg">
          {suggestions.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => { onChange(u); setOpen(false); }}
              className="block w-full text-start px-3 py-2 text-sm text-ink-1 hover:bg-surface-2 transition"
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-ink-3">🏫</span>
                {u}
              </span>
            </button>
          ))}
          <div className="px-3 py-2 text-[11px] text-ink-3 border-t border-line/60">
            Don't see it? Just type the full name — any university worldwide is accepted.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CourseField — autocomplete input wired to the canonical
 * course_catalog (5,770 courses). Debounced via useCourseSearch.
 * User can pick from the list OR type a course not in our catalog
 * (free-text fallback — we save whatever they typed). Phase 2b
 * will AI-validate brand-new course names before inserting them
 * into the catalog for future students.
 */
function CourseField({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { results, loading } = useCourseSearch(value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        required
        className="w-full h-11 px-3 rounded-xl border border-line/60 bg-surface-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-20 mt-1 w-full max-h-[320px] overflow-y-auto rounded-xl border border-line/60 bg-surface-1 shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-[11px] text-ink-3 inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c.name); setOpen(false); }}
              className="block w-full text-start px-3 py-2 text-sm text-ink-1 hover:bg-surface-2 transition"
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-ink-3">📚</span>
                {c.name}
              </span>
            </button>
          ))}
          {!loading && (
            <div className="px-3 py-2 text-[11px] text-ink-3 border-t border-line/60">
              Don't see it? Type the full course name and submit — we'll add it.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
