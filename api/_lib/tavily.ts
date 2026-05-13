/**
 * tavily.ts — thin wrapper around Tavily's search API.
 *
 * Tavily is a search API purpose-built for AI agents — results come
 * back already cleaned (no boilerplate / nav / footer), with a short
 * AI-friendly snippet per page. Free tier: 1,000 calls/month, no card
 * required. We use it as Bas Udrus's web-search layer on routes that
 * don't have Anthropic's native `web_search` tool available (i.e.
 * anything we route to Groq / Llama 4 Maverick).
 *
 * Why pre-fetched search, not tool-use:
 *   The "model decides when to search" pattern (Anthropic web_search,
 *   OpenAI function calling) requires multi-turn handling — the
 *   model pauses, we execute the tool, send results back, model
 *   resumes. On a streaming SSE path that's complex to get right.
 *
 *   Instead, the route does a lightweight heuristic check on the
 *   user's last message (`shouldSearch`), fetches Tavily if needed,
 *   and injects the results into the system prompt as a scoped block
 *   the model can reference. Same outcome from the user's POV; far
 *   simpler implementation.
 *
 *   This also means Tavily works identically across both backends
 *   (Anthropic, Groq) without the model needing to know the search
 *   happened — the system prompt just gains a "RECENT WEB CONTEXT"
 *   section when relevant.
 */

const TAVILY_API_URL = "https://api.tavily.com/search";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchTavilyArgs {
  apiKey: string;
  query: string;
  /** "basic" = ~1 credit, fast. "advanced" = ~2 credits, slower but
   *  better for nuanced queries (specific people, recent events).
   *  Default basic — we're free-tier-bound and basic is plenty for
   *  the kinds of lookups students need. */
  searchDepth?: "basic" | "advanced";
  /** Cap on result count to keep system-prompt bloat under control.
   *  3-5 is the sweet spot — more results dilute attention. */
  maxResults?: number;
  /** Optional location bias. We hardcode Jordan at the call site for
   *  the Bas Udrus use case (professor names, local resources, etc.)
   *  but the option is here for any non-Jordan queries. */
  country?: string;
  signal?: AbortSignal;
}

/**
 * Heuristic: should we hit Tavily for THIS user message?
 *
 * Web search is not free — even at Tavily's cheap rates it's $0.005/
 * call and adds 1-2 seconds of latency. We only want to search when
 * the message genuinely benefits from current data:
 *
 *   - **Professor names**: training data is stale and incomplete for
 *     Jordanian academics; web search materially improves these.
 *   - **Time-sensitive keywords**: "today", "this year", "currently",
 *     a year >= current year, "latest", "deadline", "exam date",
 *     "scholarship", "registration", etc.
 *   - **Local lookups**: doctor, therapist, hospital, clinic, course
 *     code at a specific university — these need verified current
 *     data we don't have in our DB yet.
 *
 * For everything else (math problems, code, concept explanations,
 * homework walk-throughs, emotional support, study tips), we save
 * the search call.
 *
 * Returns null when no search needed, or a refined query string
 * when search is warranted.
 */
export function shouldSearch(userMessage: string): string | null {
  if (!userMessage || userMessage.length < 4) return null;
  const lower = userMessage.toLowerCase();

  // Professor / Dr. mentions with explicit prefix. Bas Udrus's tutor.ts
  // mandates a web lookup for these, so we honor it.
  if (/\b(prof(essor)?|dr\.?|دكتور|د\.|أستاذ)\s+[a-z؀-ۿ]/i.test(userMessage)) {
    return userMessage;
  }

  // Academic-context professor names without an explicit Dr./Prof prefix.
  // Students rarely type "Dr." in casual chat — they say things like
  // "Hamdan's syllabus" or "the class with Anees" or "is Maha giving
  // a midterm". We trigger search when a capitalized non-dictionary
  // word appears alongside academic context words.
  const academicContextWords = [
    "syllabus", "midterm", "final exam", "office hours", "section",
    "lecture", "the class with", "course taught by", "professor of",
    "إمتحان", "محاضرة", "سيكشن", "مادة", "كورس",
  ];
  const hasAcademicContext = academicContextWords.some((w) => lower.includes(w));
  if (hasAcademicContext) {
    // Heuristic: if there's also a capitalized name-shaped token (not
    // at the start of the sentence, length 3+, mostly letters), search.
    const capitalizedNamePattern = /(?<!^|\.\s|\?\s|!\s)\b[A-Z][a-zء-ي]{2,}\b/;
    if (capitalizedNamePattern.test(userMessage)) {
      return userMessage;
    }
  }

  // Genuinely time-sensitive keywords that imply NEW information is
  // needed (specific events, deadlines, current data). We removed
  // generic time words like "today" / "tomorrow" / "now" — those
  // mostly carry emotional weight ("I have an exam tomorrow") not
  // a retrieval need.
  const timeKeywords = [
    "this year", "this semester", "this month",
    "latest", "recent", "upcoming",
    "deadline", "exam date", "registration deadline", "drop date",
    "scholarship", "scholarships", "tuition fee", "tuition fees",
    "admission requirements", "application deadline",
    // Arabic equivalents
    "هاد الفصل", "هاي السنة", "تسجيل", "موعد", "منحة", "منح", "بكلوريوس",
  ];
  if (timeKeywords.some((k) => lower.includes(k))) return userMessage;

  // A year reference >= current — students asking about 2026 syllabi,
  // exam years, etc. should get fresh data.
  const yearMatches = userMessage.match(/\b(20\d{2})\b/g);
  if (yearMatches) {
    const currentYear = new Date().getUTCFullYear();
    const hasFreshYear = yearMatches.some((y) => Number(y) >= currentYear);
    if (hasFreshYear) return userMessage;
  }

  // Local lookups — verified resources we may not have in DB yet.
  const localLookupKeywords = [
    "doctor", "therapist", "psychiatrist", "psychologist", "clinic",
    "hospital", "counselor", "tutor near me",
    "طبيب", "نفسي", "معالج", "عيادة", "مستشفى",
  ];
  if (localLookupKeywords.some((k) => lower.includes(k))) return userMessage;

  return null;
}

/**
 * Search Tavily and return cleaned results. Throws on transport
 * failure; returns empty array on a non-ok HTTP response (the caller
 * decides how to degrade — usually by skipping the context-injection
 * block entirely and letting the model answer from training).
 */
export async function searchTavily(args: SearchTavilyArgs): Promise<TavilyResult[]> {
  const { apiKey, query, searchDepth = "basic", maxResults = 4, country, signal } = args;
  if (!apiKey || !query) return [];
  try {
    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    };
    if (country) body.country = country;
    const res = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return [];
    const json = await res.json() as { results?: TavilyResult[] };
    return Array.isArray(json.results) ? json.results : [];
  } catch {
    return [];
  }
}

/**
 * Render Tavily results as a system-prompt block. The model can read
 * this and choose to cite specific results in its answer. We label
 * the block clearly so the model knows this is *retrieved* info, not
 * training knowledge — and so it doesn't pretend to "know" things
 * the search found.
 */
export function renderTavilyBlock(query: string, results: TavilyResult[]): string {
  if (!results || results.length === 0) return "";
  const lines: string[] = [
    "",
    "=== RECENT WEB CONTEXT (retrieved live via Tavily) ===",
    `Query: "${query}"`,
    "REQUIRED behavior:",
    "  - If a result below directly answers the student, USE it and CITE it. Append the source domain in parentheses after the claim: e.g. `(source: psutarchive.com)`.",
    "  - Every claim sourced from this block MUST end with `(source: <domain>)` in the sentence using it. No exceptions.",
    "  - If a claim can't be cited from this block or from a verified DB row, present it as a hypothesis (`I think…`, `my guess is…`), not a fact.",
    "  - If this block doesn't answer the student's question, ignore it silently and answer from your training — but don't claim you searched for what's not here.",
    "",
  ];
  results.slice(0, 5).forEach((r, i) => {
    const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`    ${r.url}`);
    if (snippet) lines.push(`    ${snippet}`);
    lines.push("");
  });
  lines.push("=== END WEB CONTEXT ===");
  lines.push("");
  return lines.join("\n");
}
