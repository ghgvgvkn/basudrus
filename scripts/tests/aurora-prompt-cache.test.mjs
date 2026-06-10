/**
 * Proves the Aurora prompt-cache split is BEHAVIOR-NEUTRAL: the model sees the
 * exact same text whether caching is on or off. High-stakes because this
 * changes the request shape on the live main AI and can't be live-tested here.
 *
 * It compiles the real api/ai/_prompts/aurora-prompt.ts (+ its imports) to a
 * temp dir with tsc, fixes ESM import extensions, then asserts:
 *   - buildAuroraSystemField(ctx, false) === buildAuroraPrompt(ctx)   (string)
 *   - buildAuroraSystemField(ctx, true) blocks' text, joined "\n\n",
 *     === buildAuroraPrompt(ctx); exactly one ephemeral cached block, first.
 *
 * Runs the compiled output against several context shapes. Self-contained:
 * `node scripts/tests/aurora-prompt-cache.test.mjs`.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const out = mkdtempSync(join(tmpdir(), 'aurora-cc-'));
let ok = true;
const t = (n, c) => { console.log(c ? '✅' : '❌', n); ok = c && ok; return c; };

try {
  // Compile the assembler + its imports to ESM JS.
  execSync(
    `npx tsc api/ai/_prompts/aurora-prompt.ts --outDir ${out} ` +
    `--module esnext --target es2020 --moduleResolution bundler --skipLibCheck --noEmitOnError false`,
    { cwd: repoRoot, stdio: 'pipe' },
  );
  // tsc emits extensionless relative imports; Node ESM needs ".js".
  for (const f of readdirSync(out).filter((f) => f.endsWith('.js'))) {
    const p = join(out, f);
    const fixed = readFileSync(p, 'utf8').replace(
      /(from\s+["'])(\.\/[^"']+?)(["'])/g,
      (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`),
    );
    writeFileSync(p, fixed);
  }

  const mod = await import(pathToFileURL(join(out, 'aurora-prompt.js')).href);
  const { buildAuroraPrompt, buildAuroraSystemField } = mod;

  const ctxs = [
    { studentName: 'Ahmed', uni: 'PSUT', major: 'CS', year: 3, lang: 'auto' },
    { studentName: 'Sara', memory: '- likes worked examples', webContext: '=== RECENT WEB CONTEXT ===\nfoo', hasMcpTools: true, includeTutoring: true, includeWellbeing: false, lang: 'en' },
    { lang: 'ar', includeTutoring: false, includeWellbeing: true },
    {},
    { includeTutoring: true, includeWellbeing: true, hasMcpTools: false },
  ];

  for (let i = 0; i < ctxs.length; i++) {
    const ctx = ctxs[i];
    const plain = buildAuroraPrompt(ctx);
    const off = buildAuroraSystemField(ctx, false);
    t(`ctx${i}: cache-off === buildAuroraPrompt`, off === plain);
    const on = buildAuroraSystemField(ctx, true);
    t(`ctx${i}: cache-on is block array`, Array.isArray(on));
    if (Array.isArray(on)) {
      t(`ctx${i}: cache-on joined === buildAuroraPrompt`, on.map((b) => b.text).join('\n\n') === plain);
      t(`ctx${i}: exactly one ephemeral cached block, first`,
        on.filter((b) => b.cache_control).length === 1 && on[0].cache_control?.type === 'ephemeral');
    }
  }
} catch (e) {
  t(`compile/run without error (${String(e).split('\n')[0]})`, false);
} finally {
  try { rmSync(out, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\nAurora prompt-cache: ${ok ? 'ALL PASSED' : 'SOME FAILED'}`);
process.exit(ok ? 0 : 1);
