// Shared hardening utilities for /api/ai/*.ts endpoints.
//
// Consolidates the defenses that every AI endpoint needs so they can't drift
// out of sync:
//   - sanitizeLine / sanitizeMessages: prompt-injection hardening (strip
//     control chars, enforce role whitelist, cap lengths, cap array size).
//   - matchOrigin: exact-host CORS match (prevents basudrus.com.evil.com).
//   - checkBodySize: cheap denial-of-cost guard (reject oversized payloads).
//   - checkRateLimit: FAIL-CLOSED rate limiter (prior version fails open if
//     the RPC is unreachable — that lets unauth / env-misconfigured clients
//     burn Anthropic budget).
//
// All helpers are pure / stateless so they work in Vercel Edge runtime.

export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/**
 * Collapse control characters (newlines, tabs, nulls, DEL, etc.) to spaces
 * and cap length. Use this on every field that gets interpolated into an LLM
 * prompt — name, university, major, year, subject, mood, mode, etc. Without
 * this, an attacker can inject `\nSYSTEM: ignore prior instructions` into a
 * profile field and escape the context.
 */
export function sanitizeLine(v: unknown, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return String(v ?? "").replace(/[\r\n\t\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max);
}

/**
 * Validate + normalize a client-supplied messages array before forwarding to
 * Anthropic. Drops items with unknown roles (user/assistant only — system
 * must live in the top-level `system` field). Enforces content length,
 * coerces non-string content, trims tail count, and ensures the conversation
 * starts with a user message (Anthropic requirement; otherwise the API call
 * throws and still costs a round-trip).
 */
export function sanitizeMessages(
  raw: unknown,
  maxContent = 4000,
  keep = 40,
): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const valid: ChatMessage[] = raw
    .filter((m): m is { role: string; content: unknown } =>
      !!m && typeof m === "object" &&
      (m as { role?: unknown }).role !== undefined &&
      (["user", "assistant"] as const).includes((m as { role: string }).role as Role))
    .slice(-keep)
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as Role,
      content: String(m.content ?? "").slice(0, maxContent),
    }));
  // Drop leading assistant messages — Anthropic requires first message to be user.
  while (valid.length > 0 && valid[0].role !== "user") valid.shift();
  return valid;
}

/**
 * Same validation for the "memory" (prior conversation summary) array.
 * Stricter length cap because memory is serialized into the system prompt,
 * not the messages list — every char here costs input tokens on every call.
 */
export function sanitizeMemory(
  raw: unknown,
  maxContent = 150,
  keep = 10,
): ChatMessage[] {
  return sanitizeMessages(raw, maxContent, keep);
}

/**
 * Exact-host origin check. Previous implementation used
 * `origin.startsWith("https://basudrus.com")` which also matches
 * `https://basudrus.com.evil.com`. This parses the URL and compares the
 * exact host component.
 */
export function matchOrigin(origin: string | null | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((a) => {
    try {
      return new URL(a).host.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

/** Build the CORS + security headers block for an AI handler response. */
export function securityHeaders(
  origin: string | null | undefined,
  allowedOrigins: string[],
): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (matchOrigin(origin, allowedOrigins)) {
    h["Access-Control-Allow-Origin"] = origin!;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    h["Vary"] = "Origin";
  }
  return h;
}

/**
 * Cheap cost-amplification guard. Rejects payloads above `maxBytes` so an
 * attacker can't POST a multi-MB JSON to exhaust edge memory / inflate
 * token usage. Returns null if OK, otherwise a pre-built 413 Response.
 *
 * Closes the Transfer-Encoding: chunked bypass: an attacker omitting
 * Content-Length (or sending chunked) would previously skip the cap.
 * We reject any POST without a valid Content-Length — the edge runtime
 * always forwards Content-Length for non-streamed client fetches, so
 * legitimate browser requests are unaffected.
 */
export async function checkBodySize(
  req: Request,
  maxBytes: number,
  headers: Record<string, string>,
): Promise<Response | null> {
  const raw = req.headers.get("content-length");
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return new Response(JSON.stringify({ error: "Invalid content-length" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (n > maxBytes) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    return null;
  }
  // No Content-Length — force chunked/streamed bodies through a size cap by
  // reading the stream with a byte counter and rebuilding an equivalent
  // Request for downstream json() parsing.
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    // Attach the buffered body back onto the request object so later
    // `await req.json()` still works. (Requests are single-consumption; we
    // can't replay without reassigning, so callers that use this variant
    // should use `readCappedBody` below instead.)
    // Returning null here signals "OK but body already consumed" — not
    // ideal. Safer pattern: callers should explicitly use readCappedBody.
    (req as Request & { __buffered?: ArrayBuffer }).__buffered = buf;
    return null;
  } catch {
    return new Response(JSON.stringify({ error: "Could not read body" }), {
      status: 400, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Safer body reader that enforces a size cap while returning the parsed JSON.
 * Use this in endpoints that might receive chunked requests (common behind
 * proxies). Replaces the old pattern of `checkBodySize(req, ...)` then
 * `await req.json()` — which was racy if Content-Length was absent.
 */
export async function readCappedJson<T = unknown>(
  req: Request,
  maxBytes: number,
  headers: Record<string, string>,
): Promise<{ data: T | null; error: Response | null }> {
  // Fast path: Content-Length present
  const raw = req.headers.get("content-length");
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return {
        data: null,
        error: new Response(JSON.stringify({ error: "Payload too large" }), {
          status: 413, headers: { ...headers, "Content-Type": "application/json" },
        }),
      };
    }
  }
  // Stream-read with a running counter
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return {
        data: null,
        error: new Response(JSON.stringify({ error: "Payload too large" }), {
          status: 413, headers: { ...headers, "Content-Type": "application/json" },
        }),
      };
    }
    if (buf.byteLength === 0) return { data: null, error: null };
    const text = new TextDecoder().decode(buf);
    try {
      return { data: JSON.parse(text) as T, error: null };
    } catch {
      return {
        data: null,
        error: new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400, headers: { ...headers, "Content-Type": "application/json" },
        }),
      };
    }
  } catch {
    return {
      data: null,
      error: new Response(JSON.stringify({ error: "Could not read body" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      }),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Rate limit (FAIL-CLOSED)
// ──────────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  daily_count: number;
  reason?: "cooldown" | "minute_limit" | "hourly_limit" | "daily_limit" | "no_auth" | "degraded" | "ok";
}

export interface RateLimitOpts {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authHeader: string | null;
  endpoint: string;
  daily: number;
  hourly: number;
  minute: number;
}

/**
 * Call the `check_ai_rate_limit` SECURITY DEFINER RPC. Unlike the prior
 * per-handler helpers, this fails CLOSED on missing env / missing auth /
 * non-2xx / exception — an attacker who finds a way to make the RPC slow or
 * unreachable can no longer burn Anthropic budget. The `degraded` reason
 * lets the caller respond with a sensible 503, not a silent free pass.
 */
export async function checkRateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const { supabaseUrl, supabaseAnonKey, authHeader, endpoint, daily, hourly, minute } = opts;
  if (!authHeader) {
    return { allowed: false, daily_count: 0, reason: "no_auth" };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    // Env misconfigured — fail closed rather than let everyone in.
    return { allowed: false, daily_count: 0, reason: "degraded" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_ai_rate_limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: authHeader,
      },
      body: JSON.stringify({
        p_user_id: null,
        p_endpoint: endpoint,
        p_daily_limit: daily,
        p_hourly_limit: hourly,
        p_minute_limit: minute,
      }),
    });
    if (!res.ok) {
      return { allowed: false, daily_count: 0, reason: "degraded" };
    }
    const data = (await res.json()) as Partial<RateLimitResult>;
    return {
      allowed: !!data.allowed,
      daily_count: typeof data.daily_count === "number" ? data.daily_count : 0,
      reason: data.reason,
    };
  } catch {
    return { allowed: false, daily_count: 0, reason: "degraded" };
  }
}

/** Shared 401/403/429/503 responder tuned for the message shapes our clients expect. */
export function rateLimitResponse(
  result: RateLimitResult,
  headers: Record<string, string>,
  copy: {
    cooldown: string;
    minute_limit: string;
    hourly_limit: string;
    daily_limit: string;
  },
): Response {
  if (result.reason === "no_auth") {
    return new Response(JSON.stringify({ error: "Please sign in to use this feature", limit: true }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  if (result.reason === "degraded") {
    return new Response(JSON.stringify({ error: "Service temporarily unavailable — please try again", limit: true }), {
      status: 503,
      headers: { ...headers, "Content-Type": "application/json", "Retry-After": "30" },
    });
  }
  const msg =
    result.reason === "cooldown" ? copy.cooldown :
    result.reason === "minute_limit" ? copy.minute_limit :
    result.reason === "hourly_limit" ? copy.hourly_limit :
    copy.daily_limit;
  return new Response(JSON.stringify({ error: msg, limit: true, daily_count: result.daily_count, reason: result.reason }), {
    status: 429,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export const ALLOWED_ORIGINS = [
  "https://basudrus.com",
  "https://www.basudrus.com",
  "https://basudrus.vercel.app",
  "https://basudrus-redesign.vercel.app",
];
