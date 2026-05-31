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
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

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
 * Aurora (life-mode Tony) variant of shouldSearch.
 *
 * The original `shouldSearch` is tuned for academic queries —
 * professors, syllabi, exam dates, university scholarship deadlines.
 * Aurora is a daily-life assistant: weather, news, restaurants,
 * current prices, sports, releases, "what time is it in Tokyo,"
 * "is the Apollo restaurant in Amman open now," "what just happened
 * with the iPhone 17." None of those trigger the academic heuristic
 * so Tony silently hallucinates instead of searching.
 *
 * Strategy: union of the academic heuristic (so the tutor's
 * existing triggers still work when an Aurora user asks something
 * academic) PLUS broader life-mode triggers. False-positive bias —
 * a slightly excessive search burns a fraction of a cent, a missed
 * search hallucinates a fact and loses user trust.
 *
 * Returns the search query string when search is warranted, null
 * otherwise — same shape as the academic shouldSearch, so the
 * caller can drop it in interchangeably.
 */
export function shouldSearchAurora(userMessage: string): string | null {
  if (!userMessage || userMessage.length < 4) return null;

  // First, honor the academic heuristic so the tutoring edge cases
  // (professor names, syllabus context, etc.) still fire when an
  // Aurora user asks an academic question.
  const academic = shouldSearch(userMessage);
  if (academic) return academic;

  const lower = userMessage.toLowerCase();

  // Explicit "search" intent — user literally asks for a lookup.
  // Highest signal there is.
  const explicitSearchKeywords = [
    "google it", "google this", "search for", "search the web",
    "look it up", "look up", "look this up", "find out",
    "what does the internet say", "what's the latest",
    "ابحث", "دور", "جوجل",
  ];
  if (explicitSearchKeywords.some((k) => lower.includes(k))) return userMessage;

  // Current-events / news triggers. People use Aurora as a daily
  // companion; "what happened today" / "any news on X" / "latest on
  // Israel-Iran" are common asks where stale training kills the
  // answer.
  const newsKeywords = [
    "news", "headline", "headlines", "breaking",
    "what happened", "what's happening", "whats happening",
    "happening today", "happening now", "going on",
    "update on", "any update", "latest update",
    "أخبار", "خبر", "صار", "بصير", "بيصير",
  ];
  if (newsKeywords.some((k) => lower.includes(k))) return userMessage;

  // Weather. Common voice-mode question, training data is useless
  // for it.
  if (/\b(weather|temperature|forecast|rain|raining|snow|snowing|sunny|hot|cold|humidity|wind)\b/i.test(userMessage)) {
    return userMessage;
  }
  if (/\b(طقس|جو|درجة الحرارة|مطر|شمس)\b/.test(userMessage)) {
    return userMessage;
  }

  // Prices, currencies, markets — anything financial that moves.
  const moneyKeywords = [
    "price of", "cost of", "how much is", "how much does",
    "exchange rate", "currency", "convert",
    "stock", "stocks", "shares", "market cap",
    "crypto", "bitcoin", "ethereum", "btc", "eth",
    "سعر", "كم سعر", "تكلفة", "عملة",
  ];
  if (moneyKeywords.some((k) => lower.includes(k))) return userMessage;

  // Local businesses / venues / places — "is X open now," "hours of
  // X," "near me," "best restaurant in," "address of X." Training
  // data is months stale for hours/menus/openings.
  const placeKeywords = [
    "open now", "open today", "still open", "closing time", "opening hours",
    "near me", "around me", "close by",
    "best restaurant", "best café", "best cafe", "best bar",
    "hotel in", "restaurant in", "café in", "cafe in",
    "address of", "phone number for", "phone number of",
    "directions to", "how to get to",
    "بقرب", "حواليّ", "أفضل مطعم", "أفضل مقهى",
  ];
  if (placeKeywords.some((k) => lower.includes(k))) return userMessage;

  // Sports — scores, schedules, standings, transfers. All
  // perishable.
  const sportsKeywords = [
    "score", "scores", "game tonight", "match tonight", "tonight's game",
    "playing tonight", "playing today", "who's winning", "whos winning",
    "standings", "rankings", "transfer", "signed with",
    "match", "fixture", "playoff", "playoffs", "world cup",
  ];
  if (sportsKeywords.some((k) => lower.includes(k))) return userMessage;

  // Time zones — "what time is it in Tokyo," "what's the time in NYC."
  if (/\bwhat\s+time\s+is\s+it\s+in\b/i.test(userMessage)) return userMessage;
  if (/\btime\s+(?:right\s+)?now\s+in\b/i.test(userMessage)) return userMessage;

  // Product releases / launches — perishable info, very common in
  // tech-curious user queries.
  const releaseKeywords = [
    "release date", "launch date", "when does", "when did",
    "released", "launched", "announced", "coming out",
    "iphone", "samsung galaxy", "pixel", "macbook", "playstation", "xbox",
    "new model", "new version",
  ];
  if (releaseKeywords.some((k) => lower.includes(k))) return userMessage;

  // Current-year / future-year mentions are already covered by the
  // base shouldSearch year heuristic (we re-ran it at the top via
  // shouldSearch(userMessage)).

  // Concrete companies / brands / entities — capitalized noun in
  // the message implies a real-world entity. Combined with question
  // mark or interrogative, it's likely a "tell me about X" research
  // moment that benefits from web context. Conservative: requires
  // a real question, not just any sentence with a name.
  const isQuestion = userMessage.includes("?")
    || /\b(what|who|where|when|why|how|is\s+\w+|are\s+\w+|does\s+\w+|do\s+\w+|did\s+\w+|will\s+\w+|can\s+\w+)\b/i.test(userMessage);
  if (isQuestion) {
    // Capitalized noun pattern — at least 4 chars, not at the very
    // start of the message (where it could just be capitalization).
    const capName = /(?<!^|\.\s|\?\s|!\s)\b[A-Z][a-zA-Z]{3,}\b/;
    if (capName.test(userMessage)) return userMessage;
  }

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

// ───────────────────────── URL extraction ─────────────────────────
//
// "Paste a link, Tony reads it." Distinct from search: the user gives us
// an EXACT url and wants its CONTENTS read, not a web search. shouldSearch
// deliberately does NOT trigger on a bare URL, so without this the link
// just sat in the prompt as an unfetched string and Tony hallucinated
// about it. Tavily's /extract endpoint pulls cleaned page text (same
// boilerplate-stripped quality as search), which we inject like the
// search block.

// Matches http(s) URLs in free text. Intentionally conservative: requires
// a scheme so we don't try to "extract" every bare word with a dot. The
// trailing class stops before common sentence punctuation so "see https://x.com."
// doesn't capture the period.
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

/**
 * Pull up to `max` distinct http(s) URLs out of a user message. Returns []
 * when none are present. Caps length per URL defensively (a pathological
 * 5000-char "url" is not a real link). De-dupes exact repeats.
 */
export function extractUrls(userMessage: string, max = 3): string[] {
  if (!userMessage) return [];
  const found = userMessage.match(URL_RE);
  if (!found) return [];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    // Trim trailing punctuation a URL won't really end with.
    const u = raw.replace(/[.,;:!?)\]]+$/, "");
    if (u.length < 12 || u.length > 2000) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    cleaned.push(u);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}

export interface TavilyExtractResult {
  url: string;
  /** Cleaned page text (boilerplate stripped by Tavily). */
  content: string;
}

/**
 * Extract cleaned page content for one or more URLs via Tavily /extract.
 * Returns [] on any failure (caller degrades by just not injecting the
 * block — the model still sees the raw URL in the user's message). Never
 * throws.
 */
export async function extractTavily(args: {
  apiKey: string;
  urls: string[];
  signal?: AbortSignal;
}): Promise<TavilyExtractResult[]> {
  const { apiKey, urls, signal } = args;
  if (!apiKey || !urls || urls.length === 0) return [];
  try {
    const res = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        // Tavily accepts a single url string or an array; send an array.
        urls,
        // basic depth is enough for an article/page read and cheaper.
        extract_depth: "basic",
      }),
      signal,
    });
    if (!res.ok) return [];
    // Tavily /extract returns { results: [{ url, raw_content }], failed_results: [...] }
    const json = (await res.json()) as {
      results?: Array<{ url?: string; raw_content?: string; content?: string }>;
    };
    if (!Array.isArray(json.results)) return [];
    return json.results
      .map((r) => ({
        url: typeof r.url === "string" ? r.url : "",
        content: (r.raw_content || r.content || "").toString(),
      }))
      .filter((r) => r.url && r.content);
  } catch {
    return [];
  }
}

/**
 * Render extracted page content as a system-prompt block. Caps each page
 * so a long article doesn't blow the context budget (4000 chars ≈ a few
 * pages of text — enough for Tony to answer questions about it).
 */
export function renderExtractBlock(results: TavilyExtractResult[]): string {
  if (!results || results.length === 0) return "";
  const lines: string[] = [
    "",
    "=== LINKED PAGE CONTENT (the student shared these links — read them) ===",
    "The student included these URLs in their message. Their CONTENTS were fetched live and are below.",
    "REQUIRED behavior:",
    "  - Treat this as the primary material the student wants help with. Read it carefully before answering.",
    "  - When you use a fact from a page, cite its domain in parentheses: e.g. `(source: <domain>)`.",
    "  - If the fetched content seems truncated or off-topic, say so plainly rather than guessing what the rest said.",
    "",
  ];
  results.slice(0, 3).forEach((r, i) => {
    const body = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    lines.push(`[Link ${i + 1}] ${r.url}`);
    if (body) lines.push(body);
    lines.push("");
  });
  lines.push("=== END LINKED PAGE CONTENT ===");
  lines.push("");
  return lines.join("\n");
}
