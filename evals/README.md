# Bas Udrus Eval Suite

A small test runner that hits your deployed `/api/ai/tutor` and `/api/ai/wellbeing` endpoints with real student-shape messages and checks the response against constitution clauses (see `docs/constitution.md`).

**Use it before every prompt deploy. If it goes red, fix the regression before shipping.**

## How to run

```bash
# 1. Set a test user's Supabase access token
export EVAL_BEARER_TOKEN="<your-test-supabase-jwt>"

# 2. Set the base URL (defaults to your prod for safety; override for staging)
export EVAL_BASE_URL="https://basudrus.com"

# 3. Run a suite (omar or noor)
node evals/run.mjs --suite omar
node evals/run.mjs --suite noor

# 4. Run a single case by id
node evals/run.mjs --suite omar --only omar-04-identity-am-i-talking-to-ai
```

Exit code is `0` on all-pass, `1` on any-fail — so it can be wired into CI later.

## Suite shape

Each `*.json` suite has:

```jsonc
{
  "endpoint": "/api/ai/tutor",          // or /api/ai/wellbeing
  "defaults": { /* profile fields injected on every request */ },
  "cases": [
    {
      "id": "omar-01-...",                // unique
      "category": "short-message",        // tag for grouping
      "constitution": "MUST 7",           // which constitution clause this tests
      "messages": [{ "role": "user", "content": "..." }],
      "expects": [
        { "kind": "containsAny",    "values": ["..."] },
        { "kind": "containsNone",   "values": ["..."] },
        { "kind": "matchesRegex",   "pattern": "..." },
        { "kind": "shorterThan",    "chars": 600 },
        { "kind": "longerThan",     "chars": 200 }
      ]
    }
  ]
}
```

## Assertion kinds

| kind          | semantics                                                            |
|---------------|----------------------------------------------------------------------|
| containsAny   | reply must contain at least one of `values` (case-insensitive)       |
| containsNone  | reply must NOT contain any of `values` (case-insensitive)            |
| matchesRegex  | reply must match `pattern` (JS RegExp, no flags by default)          |
| shorterThan   | reply length (chars) must be < `chars`                               |
| longerThan    | reply length (chars) must be > `chars`                               |

## How the runner works

1. Reads the suite JSON.
2. For each case, POSTs to the endpoint with `messages` + `defaults` as the body.
3. Reads the SSE stream, concatenating the `content` chunks into a single reply string.
4. Runs each assertion against the reply.
5. Prints per-case pass/fail and a summary.

This is intentionally simple — no LLM judges (flaky and expensive), no embedding similarity. Just keyword/regex/length checks that map 1:1 to constitution clauses. When a check is too strict or too loose, edit the JSON.

## When to add a new case

Whenever a thumbs-down comes in from `tutor_feedback` that surfaces a real bug, distill it into a case here. The suite grows over time; that growth is the whole point.
