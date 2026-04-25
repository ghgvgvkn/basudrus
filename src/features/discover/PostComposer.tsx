/**
 * PostComposer — "I need help with [course]" modal.
 *
 * Triggered from three places in the UI:
 *   - Home → "Post for help" button on the streak card
 *   - Discover → FAB
 *   - Sidebar / MobileNav (desktop + mobile chrome)
 *
 * All three route through AppContext.openPostComposer(); this
 * component is mounted once in Shell and listens to
 * `postComposerOpen` to decide visibility.
 *
 * Data shape inserted into `help_requests`:
 *   { user_id, subject (course), detail (title + optional body), meet_type }
 *
 * Title and detail in the form merge into the row's `detail` column
 * because the production schema doesn't have a separate title field —
 * the card UI renders detail as the body line, so the headline going
 * first means it's what users see on the feed card.
 *
 * After a successful insert we dispatch `bu:posts-changed` on window
 * so useDiscoverFeed re-fetches and the new ask appears at the top
 * of the feed without a manual refresh.
 */
import { useState, useRef, useEffect } from "react";
import { X, Search, GraduationCap, AlertCircle } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { useCourseSearch } from "./useCourseSearch";

type Meet = "online" | "in_person" | "either";

export function PostComposer() {
  const { postComposerOpen, closePostComposer } = useApp();
  const { user } = useSupabaseSession();
  const [course, setCourse] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [meet, setMeet] = useState<Meet>("either");
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const courseInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the course picker on open; reset everything on close.
  useEffect(() => {
    if (postComposerOpen) {
      setDone(false);
      setErr(null);
      queueMicrotask(() => courseInputRef.current?.focus());
    } else {
      setCourse(""); setCourseQuery(""); setTitle(""); setDetail("");
      setMeet("either"); setPosting(false); setErr(null);
    }
  }, [postComposerOpen]);

  // Escape closes.
  useEffect(() => {
    if (!postComposerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePostComposer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [postComposerOpen, closePostComposer]);

  // Live course search from `uni_courses` (36k+ rows in prod). Empty
  // query returns popular first 12, typing filters via ILIKE.
  const { results: courseMatches, loading: coursesLoading } = useCourseSearch(courseQuery);

  // canPost requires an authed user — RLS blocks the insert otherwise
  // and we'd rather disable the button than surface a 401.
  const canPost = !!user && course.length > 0 && title.trim().length >= 4 && !posting;

  const submit = async () => {
    if (!canPost || !supabase || !user) return;
    setErr(null);
    setPosting(true);
    try {
      // Schema has subject + detail + meet_type. PostComposer captures
      // a separate title, so we fold it into detail: title on its own
      // line, optional supplementary detail underneath. The card UI
      // renders detail as the body text, so the headline lands where
      // users look first.
      const trimmedTitle = title.trim();
      const trimmedDetail = detail.trim();
      const composedDetail = trimmedDetail
        ? `${trimmedTitle}\n\n${trimmedDetail}`
        : trimmedTitle;

      const { error } = await supabase.from("help_requests").insert({
        user_id: user.id,
        subject: course,
        detail: composedDetail,
        meet_type: meet,
      });
      if (error) throw error;

      // Tell DiscoverFeed (+ anyone else who cares) to re-fetch.
      // CustomEvent on window is the cheapest cross-component signal
      // that doesn't require a shared store.
      try { window.dispatchEvent(new CustomEvent("bu:posts-changed")); } catch { /* noop */ }

      setPosting(false);
      setDone(true);
      setTimeout(() => closePostComposer(), 900);
    } catch (e) {
      setPosting(false);
      const raw = e instanceof Error ? e.message : String(e);
      setErr(raw.includes("row-level security")
        ? "Sign in to post for help."
        : raw || "Couldn't post. Try again.");
      if (import.meta.env.DEV) console.warn("[PostComposer] insert failed:", e);
    }
  };

  if (!postComposerOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post for help"
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 animate-[fadeIn_120ms_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closePostComposer(); }}
    >
      <div className="absolute inset-0 bg-ink-1/45 backdrop-blur-sm" aria-hidden />
      <div className="relative w-full max-w-[560px] max-h-[92dvh] overflow-y-auto bg-surface-1 rounded-[28px] border border-line shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="serif text-2xl text-ink-1" style={{ fontStyle: "italic" }}>
            Post for help
          </h2>
          <button
            onClick={closePostComposer}
            aria-label="Close"
            className="h-9 w-9 rounded-full grid place-items-center text-ink-3 hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-10 text-center">
            <div className="serif text-2xl text-ink-1 mb-1" style={{ fontStyle: "italic" }}>Posted ✓</div>
            <p className="text-ink-3 text-sm">We'll match it to study partners in {course}.</p>
          </div>
        ) : (
          <>
            {/* Course picker */}
            <section className="px-6 pb-4">
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">
                Course<span className="text-rose-600">*</span>
              </label>
              {course ? (
                <div className="flex items-center gap-2 h-11 px-3 rounded-lg bg-accent-soft border border-accent/30">
                  <GraduationCap className="h-4 w-4 text-accent-ink" />
                  <span className="text-sm font-semibold text-accent-ink">{course}</span>
                  <button
                    onClick={() => { setCourse(""); setCourseQuery(""); }}
                    className="ms-auto h-7 w-7 rounded-full grid place-items-center text-accent-ink/70 hover:bg-white/40"
                    aria-label="Change course"
                  ><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3 pointer-events-none" />
                    <input
                      ref={courseInputRef}
                      value={courseQuery}
                      onChange={(e) => setCourseQuery(e.target.value)}
                      placeholder="Search courses (CS 301, Calc, Biology…)"
                      className="w-full h-11 ps-10 pe-3 rounded-lg border border-line bg-surface-2 focus:border-accent focus:bg-surface-1 outline-none text-ink-1 placeholder:text-ink-3 text-sm transition-colors"
                    />
                  </div>
                  <ul className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-line divide-y divide-line">
                    {courseMatches.map((c) => {
                      // `uni_courses.name` stores the display text which
                      // often looks like "CS 301 · Databases" — split
                      // on the first whitespace+digit run to highlight
                      // the code when present, otherwise just show
                      // the plain name.
                      const codeMatch = c.name.match(/^([A-Z]{2,}\s?\d{2,4}[A-Z]?)\s*[·\-:]?\s*(.*)$/);
                      const code = codeMatch?.[1];
                      const rest = codeMatch?.[2] || c.name;
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => setCourse(c.name)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-start hover:bg-surface-2"
                          >
                            {code && (
                              <span className="font-mono text-xs font-semibold text-accent-ink bg-accent-soft px-2 py-1 rounded shrink-0">
                                {code}
                              </span>
                            )}
                            <span className="text-sm text-ink-1 truncate">{rest || c.name}</span>
                          </button>
                        </li>
                      );
                    })}
                    {!coursesLoading && courseMatches.length === 0 && (
                      <li className="px-3 py-3 text-sm text-ink-3 text-center">
                        No matches{courseQuery ? ` for "${courseQuery}"` : ""}
                      </li>
                    )}
                    {coursesLoading && courseMatches.length === 0 && (
                      <li className="px-3 py-3 text-sm text-ink-3 text-center">Searching…</li>
                    )}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-ink-3">
                    Searching {coursesLoading ? "…" : "36,000+"} courses from your universities.
                  </p>
                </>
              )}
            </section>

            {/* Title */}
            <section className="px-6 pb-4">
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">
                What do you need help with?<span className="text-rose-600">*</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                placeholder="e.g. Stuck on recursive SQL joins"
                className="w-full h-11 px-3 rounded-lg border border-line bg-surface-2 focus:border-accent focus:bg-surface-1 outline-none text-ink-1 placeholder:text-ink-3 text-sm"
              />
            </section>

            {/* Detail */}
            <section className="px-6 pb-4">
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">
                Detail (optional)
              </label>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Anything that helps a match understand — textbook page, concept, deadline."
                className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 focus:border-accent focus:bg-surface-1 outline-none text-ink-1 placeholder:text-ink-3 text-sm resize-none"
              />
            </section>

            {/* Meet preference */}
            <section className="px-6 pb-5">
              <label className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">How to meet</label>
              <div role="radiogroup" className="flex gap-2">
                {([
                  ["online",    "Online"],
                  ["in_person", "In person"],
                  ["either",    "Either"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={meet === k}
                    onClick={() => setMeet(k)}
                    className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                      meet === k
                        ? "bg-ink-1 text-surface-0"
                        : "bg-surface-2 text-ink-2 border border-line hover:bg-surface-3"
                    }`}
                  >{label}</button>
                ))}
              </div>
            </section>

            {err && (
              <div className="mx-6 mb-3 flex items-start gap-2 p-3 rounded-lg bg-[#C23F6C]/10 text-[#C23F6C] text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-6 pb-5 pt-1 border-t border-line bg-surface-2/60">
              <button
                onClick={closePostComposer}
                className="h-11 px-5 rounded-full text-sm font-medium text-ink-2 hover:bg-surface-3"
              >Cancel</button>
              <button
                onClick={submit}
                disabled={!canPost}
                className="flex-1 h-11 rounded-full bg-accent text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition"
              >
                {posting ? "Posting…" : "Post for help"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
