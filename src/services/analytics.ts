import { supabase } from "@/lib/supabase";

// ─── ERROR LOGGING (production-safe + remote reporting) ─────────────────────
let _errorUserId: string | null = null;
export function setErrorUserId(id: string | null) { _errorUserId = id; }

export function logError(context: string, error: unknown) {
  const msg = error instanceof Error ? error.message : typeof error === "object" && error !== null ? JSON.stringify(error).slice(0, 200) : String(error);
  if (import.meta.env.DEV) console.error(`[BasUdrus:${context}] ${msg}`);
  // Report to DB (fire-and-forget, never blocks UI)
  if (_errorUserId) {
    supabase.from("client_errors").insert({
      user_id: _errorUserId,
      error_type: context.split(":")[0] || "unknown",
      context,
      message: msg.slice(0, 500),
      user_agent: navigator.userAgent.slice(0, 200),
    }).then(() => {}, () => {});  // Silent — never affects user
  }
}

// ─── EVENT TRACKER (lean — batched + sampled to minimize DB writes) ──────────
// Critical events (errors, failures): always logged immediately
// High-frequency events (msg_sent, chat_open, post_click, ai_call): counted
//   locally and flushed as a single summary row every 60 seconds
const _eventQueue: { user_id: string | null; event: string; screen: string; meta: Record<string, unknown>; created_at: string }[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _currentScreen = "landing";

// Counters for high-frequency events — flushed as one summary row
const _counters: Record<string, number> = {};
let _counterTimer: ReturnType<typeof setTimeout> | null = null;

// Events that are high-frequency and should be counted, not logged individually
const COUNTED_EVENTS = new Set(["msg_sent", "chat_open", "post_click", "ai_call", "voice_sent"]);

// ── Burst detection: sliding window timestamps per event type ────────────────
const _burstLog: Record<string, number[]> = {};
const _burstFired: Record<string, number> = {};  // cooldown: last spike alert time
const BURST_RULES: Record<string, { limit: number; windowMs: number; spike: string }> = {
  msg_sent:    { limit: 10, windowMs: 10_000, spike: "msg_spike" },
  ai_call:     { limit: 5,  windowMs: 30_000, spike: "ai_spike" },
  post_click:  { limit: 8,  windowMs: 10_000, spike: "ux_spike" },
  retry_click: { limit: 5,  windowMs: 15_000, spike: "ux_spike" },
};

function checkBurst(event: string) {
  const rule = BURST_RULES[event];
  if (!rule) return;
  const now = Date.now();
  // Record timestamp
  if (!_burstLog[event]) _burstLog[event] = [];
  _burstLog[event].push(now);
  // Trim to window
  const cutoff = now - rule.windowMs;
  _burstLog[event] = _burstLog[event].filter(t => t > cutoff);
  // Check threshold + cooldown (60s between alerts of same type)
  if (_burstLog[event].length >= rule.limit && (now - (_burstFired[event] || 0)) > 60_000) {
    _burstFired[event] = now;
    // Log as individual critical event — bypasses summary
    _eventQueue.push({
      user_id: _errorUserId,
      event: rule.spike,
      screen: _currentScreen,
      meta: { count: _burstLog[event].length, window_sec: rule.windowMs / 1000, source: event },
      created_at: new Date().toISOString(),
    });
    // Flush immediately — spikes are urgent
    flushEvents();
    // Alert admin instantly via DB notification
    const spikeMsg = `${rule.spike}: ${_burstLog[event].length} ${event} events in ${rule.windowMs / 1000}s`;
    supabase.rpc("report_spike", {
      spike_type: rule.spike,
      spike_message: spikeMsg,
      spike_meta: { count: _burstLog[event].length, window_sec: rule.windowMs / 1000, source: event, screen: _currentScreen },
    }).then(() => {}, () => {});
  }
}

export function trackEvent(event: string, meta: Record<string, unknown> = {}) {
  // High-frequency events: count locally + check for abnormal bursts
  if (COUNTED_EVENTS.has(event)) {
    _counters[event] = (_counters[event] || 0) + 1;
    checkBurst(event);
    if (!_counterTimer) _counterTimer = setTimeout(flushCounters, 60_000);
    return;
  }
  // Check burst even for critical events that have rules (e.g. retry_click)
  if (BURST_RULES[event]) checkBurst(event);
  // Critical/low-frequency events: queue for DB insert
  _eventQueue.push({
    user_id: _errorUserId,
    event,
    screen: _currentScreen,
    meta,
    created_at: new Date().toISOString(),
  });
  // Flush after 10s of inactivity, or immediately if queue hits 15
  if (_flushTimer) clearTimeout(_flushTimer);
  if (_eventQueue.length >= 15) {
    flushEvents();
  } else {
    _flushTimer = setTimeout(flushEvents, 10_000);
  }
}

function flushCounters() {
  _counterTimer = null;
  const entries = Object.entries(_counters);
  if (entries.length === 0) return;
  // Single row with all counts as meta
  const summary: Record<string, unknown> = {};
  for (const [k, v] of entries) { summary[k] = v; _counters[k] = 0; }
  // Only flush if there's actually activity
  if (entries.some(([, v]) => v > 0)) {
    supabase.from("events").insert({
      user_id: _errorUserId,
      event: "activity_summary",
      screen: _currentScreen,
      meta: summary,
      created_at: new Date().toISOString(),
    }).then(() => {}, () => {});
  }
  // Reset counters
  for (const k of Object.keys(_counters)) _counters[k] = 0;
}

function flushEvents() {
  if (_eventQueue.length === 0) return;
  const batch = _eventQueue.splice(0, 50);
  supabase.from("events").insert(batch).then(() => {}, () => {});
}

// Flush on tab close + global error catching
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { flushCounters(); flushEvents(); });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { flushCounters(); flushEvents(); }
  });
  // Catch uncaught errors — always logged (critical)
  window.addEventListener("error", (e) => {
    trackEvent("js_error", { message: (e.message || "").slice(0, 300), file: (e.filename || "").split("/").pop(), line: e.lineno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason || "");
    trackEvent("js_error", { message: msg.slice(0, 300), type: "unhandled_promise" });
  });
}

// UX signal: detect repeated rapid clicks (confusion/lag indicator)
let _lastClickEvent = "";
let _lastClickTime = 0;
let _rapidClickCount = 0;

export function trackClick(event: string, meta: Record<string, unknown> = {}) {
  const now = Date.now();
  if (event === _lastClickEvent && now - _lastClickTime < 1500) {
    _rapidClickCount++;
    if (_rapidClickCount === 3) {
      // This is critical UX signal — always log
      trackEvent("retry_click", { ...meta, original_event: event, clicks: _rapidClickCount });
      _rapidClickCount = 0;
    }
  } else {
    _rapidClickCount = 1;
  }
  _lastClickEvent = event;
  _lastClickTime = now;
  trackEvent(event, meta);
}

export function setCurrentScreen(s: string) { _currentScreen = s; }
