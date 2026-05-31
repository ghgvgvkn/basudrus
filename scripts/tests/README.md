# Lightweight regression tests

Plain-Node test scripts — **no framework, no dependencies**. Each file
exits non-zero on failure so it can gate a deploy if wired into CI later.

```bash
node scripts/tests/choices.test.mjs
node scripts/tests/urls.test.mjs
node scripts/tests/security.test.mjs
```

These mirror the pure logic of the matching source files. If you change the
source, update the mirrored logic here too (they're intentionally
self-contained so they run with zero setup — `node <file>`).

| file | mirrors | covers |
|---|---|---|
| `choices.test.mjs` | `mobile/src/lib/parseChoices.ts` | `<<option>>` / `<<options>>` / `<</option>>` / fenced / bullets / partial-stream / Arabic |
| `urls.test.mjs` | `api/_lib/tavily.ts` `extractUrls` | URL detection, trailing punctuation, dedupe, cap, non-http reject |
| `security.test.mjs` | `api/ai/aurora.ts` Zapier host check + `api/geo.ts` IP check | host-parse anti-spoof, https-only, IPv4/IPv6 validation |

Why mirrored, not imported: the sources are `.ts` (mobile uses RN module
resolution; api uses Vercel edge globals), so importing them in a bare Node
script needs a build step. Mirroring keeps these runnable instantly. The
logic is small and stable enough that drift is low-risk, and the mirror is
clearly labelled in each file.
