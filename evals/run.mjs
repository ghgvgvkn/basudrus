#!/usr/bin/env node
/**
 * Bas Udrus eval runner.
 *
 * Usage:
 *   EVAL_BEARER_TOKEN=<jwt> node evals/run.mjs --suite omar
 *   EVAL_BEARER_TOKEN=<jwt> node evals/run.mjs --suite noor
 *   EVAL_BEARER_TOKEN=<jwt> node evals/run.mjs --suite omar --only omar-04-...
 *
 * Env:
 *   EVAL_BEARER_TOKEN   Required. A Supabase access token for any test user.
 *   EVAL_BASE_URL       Optional. Defaults to https://basudrus.com.
 *   EVAL_CONCURRENCY    Optional. Defaults to 3. Avoid rate limits.
 *
 * Exit code: 0 on all-pass, 1 on any-fail. Wire into CI.
 *
 * Pure Node. No deps beyond what ships with Node 18+ (global fetch).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── args
const args = process.argv.slice(2);
const argMap = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    argMap[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
}
const suiteName = argMap.suite || "omar";
const only = argMap.only || null;
const baseUrl = (process.env.EVAL_BASE_URL || "https://basudrus.com").replace(/\/$/, "");
const token = process.env.EVAL_BEARER_TOKEN || "";
const concurrency = Math.max(1, parseInt(process.env.EVAL_CONCURRENCY || "3", 10));

if (!token) {
  console.error("FATAL: EVAL_BEARER_TOKEN env var is required.");
  process.exit(2);
}

const suitePath = resolve(__dirname, `${suiteName}-suite.json`);
let suite;
try {
  suite = JSON.parse(readFileSync(suitePath, "utf8"));
} catch (e) {
  console.error(`FATAL: failed to read ${suitePath}: ${e.message}`);
  process.exit(2);
}

const endpoint = suite.endpoint;
const defaults = suite.defaults || {};
let cases = suite.cases || [];
if (only) cases = cases.filter((c) => c.id === only);
if (cases.length === 0) {
  console.error(`No cases to run (suite=${suiteName}, only=${only ?? "<none>"})`);
  process.exit(2);
}

console.log(`▶ ${suite.name} — ${cases.length} case(s) against ${baseUrl}${endpoint}\n`);

// ── runner
async function runCase(c) {
  const body = {
    ...defaults,
    messages: c.messages,
  };
  let reply = "";
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { case: c, ok: false, failures: [`HTTP ${res.status}: ${await safeText(res)}`], reply: "", ms: Date.now() - started };
    }
    if (!res.body) {
      return { case: c, ok: false, failures: ["empty response body"], reply: "", ms: Date.now() - started };
    }
    reply = await collectSse(res.body);
  } catch (e) {
    return { case: c, ok: false, failures: [`network error: ${e.message}`], reply: "", ms: Date.now() - started };
  }
  const failures = [];
  for (const ex of c.expects || []) {
    const f = check(reply, ex);
    if (f) failures.push(f);
  }
  return { case: c, ok: failures.length === 0, failures, reply, ms: Date.now() - started };
}

async function safeText(res) {
  try { return await res.text(); } catch { return "<unreadable>"; }
}

/** Read SSE stream and concatenate `content` deltas into a string. */
async function collectSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (typeof parsed.content === "string") out += parsed.content;
      } catch {
        // not JSON — ignore
      }
    }
  }
  return out;
}

/** Returns null on pass, or a string describing the failure. */
function check(reply, ex) {
  const lower = reply.toLowerCase();
  switch (ex.kind) {
    case "containsAny": {
      const hit = (ex.values || []).some((v) => lower.includes(String(v).toLowerCase()));
      return hit ? null : `containsAny failed — none of [${(ex.values || []).join(", ")}] present`;
    }
    case "containsNone": {
      const bad = (ex.values || []).find((v) => lower.includes(String(v).toLowerCase()));
      return bad ? `containsNone failed — found forbidden phrase: "${bad}"` : null;
    }
    case "matchesRegex": {
      const re = new RegExp(ex.pattern);
      return re.test(reply) ? null : `matchesRegex failed — pattern ${ex.pattern} did not match`;
    }
    case "shorterThan": {
      return reply.length < ex.chars ? null : `shorterThan failed — reply is ${reply.length} chars (limit ${ex.chars})`;
    }
    case "longerThan": {
      return reply.length > ex.chars ? null : `longerThan failed — reply is ${reply.length} chars (min ${ex.chars})`;
    }
    default:
      return `unknown assertion kind: ${ex.kind}`;
  }
}

/** Bounded-concurrency map. */
async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// ── go
const results = await pmap(cases, concurrency, async (c, idx) => {
  const r = await runCase(c);
  const mark = r.ok ? "✓" : "✗";
  const ms = `${r.ms}ms`.padStart(6);
  console.log(`  ${mark} [${ms}] ${c.id}  — ${c.category}`);
  if (!r.ok) {
    for (const f of r.failures) console.log(`      ↳ ${f}`);
    if (r.reply) console.log(`      ↳ reply preview: ${r.reply.slice(0, 200).replace(/\n/g, " ")}…`);
  }
  return r;
});

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} failed` : ""}`);

process.exit(failed > 0 ? 1 : 0);
