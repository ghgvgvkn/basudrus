/**
 * CoursesPicker — searchable multi-select backed by uni_courses.
 *
 * Reused on:
 *   - ProfileScreen edit form (current-semester courses)
 *   - OnboardingScreen Profile step
 *
 * Selection is by course NAME so it round-trips through the
 * profiles.subjects text[] column without needing IDs. Free-text
 * fallback ("Add as a custom course") covers electives that aren't
 * in the catalog.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { useCourseSearch } from "@/features/discover/useCourseSearch";

export function CoursesPicker({
  selected, onChange, placeholder, max = 20,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [query, setQuery] = useState("");
  const { results, loading } = useCourseSearch(query);

  const add = (name: string) => {
    const v = name.trim();
    if (!v) return;
    if (selected.length >= max) return;
    if (selected.some(s => s.toLowerCase() === v.toLowerCase())) return;
    onChange([...selected, v]);
    setQuery("");
  };

  const remove = (name: string) => {
    onChange(selected.filter(s => s !== name));
  };

  // 1. Drop results already selected.
  // 2. Dedupe by lowercase name — the catalog has the same course
  //    name (e.g. "Anatomy I") under multiple major rows, so a
  //    naive uniq-by-id render shows the same name 5+ times. The
  //    user clicks one and nothing visibly happens because the
  //    name is already in `selected` and add() silently no-ops.
  //    Dedupe BEFORE render so each course name appears once.
  const visibleResults = (() => {
    const seen = new Set<string>();
    const out: typeof results = [];
    for (const r of results) {
      const key = r.name.trim().toLowerCase();
      if (!key) continue;
      if (selected.some(s => s.toLowerCase() === key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  })();

  return (
    <div className="space-y-2.5">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map(s => (
            <li key={s}>
              <button
                type="button"
                onClick={() => remove(s)}
                className="inline-flex items-center gap-1.5 h-8 ps-3 pe-2 rounded-full bg-accent-soft text-accent-ink text-xs font-medium border border-accent/30 hover:bg-accent hover:text-white transition-colors group"
              >
                <span className="truncate max-w-[200px]">{s}</span>
                <X className="h-3 w-3 opacity-70 group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              add(query);
            }
          }}
          placeholder={placeholder ?? "Search courses (CS 301, Calculus, Biology…) and tap to add"}
          className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 text-ink-1 placeholder:text-ink-3 focus:border-accent outline-none text-sm"
        />
        {(query.trim().length > 0 || results.length > 0) && (
          <ul className="mt-2 max-h-[180px] overflow-y-auto rounded-lg border border-line divide-y divide-line bg-surface-1">
            {visibleResults.slice(0, 8).map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => add(c.name)}
                  className="w-full text-start px-3 py-2 text-sm text-ink-1 hover:bg-surface-2"
                >{c.name}</button>
              </li>
            ))}
            {!loading && visibleResults.length === 0 && query.trim() && (
              <li>
                <button
                  type="button"
                  onClick={() => add(query)}
                  className="w-full text-start px-3 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >Add "{query.trim()}" as a custom course</button>
              </li>
            )}
            {loading && visibleResults.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-3 text-center">Searching…</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
