// Text-to-3D lifecycle test — imports the REAL TypeScript sources
// (ai-app/src/jarvis/generate3d.ts and api/_lib/model3d-sign.ts) via
// Node native type stripping, same zero-drift pattern as
// jarvis-explode.test.mjs.
import {
  classifyCreate,
  classifyPoll,
  isTerminal,
  pollDelayMs,
  MAX_POLL_MS,
} from "../../ai-app/src/jarvis/generate3d.ts";
import {
  signJobToken,
  verifyJobToken,
  isValidJobId,
} from "../../api/_lib/model3d-sign.ts";

const t = (name, cond) => {
  console.log(cond ? "✅" : "❌", name);
  return cond;
};
let all = true;

// ── classifyCreate ──────────────────────────────────────────────────

all &= t(
  "create 200 created → pending with job",
  (() => {
    const s = classifyCreate(200, { status: "created", jobId: "abc-123", token: "tok" });
    return s.phase === "pending" && s.jobId === "abc-123" && s.token === "tok";
  })(),
);
all &= t("create 401 → unauthorized", classifyCreate(401, {}).phase === "unauthorized");
all &= t(
  "create 429 carries server copy",
  (() => {
    const s = classifyCreate(429, { message: "Daily 3D generation limit reached." });
    return s.phase === "rate_limited" && s.message.includes("Daily");
  })(),
);
all &= t(
  "create not_configured → friendly dormant state",
  classifyCreate(200, { status: "not_configured" }).phase === "not_configured",
);
all &= t("create 502 junk → failed", classifyCreate(502, { status: "failed" }).phase === "failed");
all &= t(
  "create 200 but missing jobId → failed (no doomed poll loop)",
  classifyCreate(200, { status: "created", token: "tok" }).phase === "failed",
);

// ── classifyPoll ────────────────────────────────────────────────────

all &= t(
  "poll running carries REAL progress",
  (() => {
    const s = classifyPoll(200, { status: "running", progress: 42 });
    return s.phase === "generating" && s.progress === 42;
  })(),
);
all &= t(
  "poll progress is clamped 0..100",
  classifyPoll(200, { status: "running", progress: 940 }).progress === 100 &&
    classifyPoll(200, { status: "running", progress: -5 }).progress === 0,
);
all &= t(
  "poll succeeded → loading with modelUrl",
  (() => {
    const s = classifyPoll(200, { status: "succeeded", modelUrl: "https://x/m.glb" });
    return s.phase === "loading" && s.modelUrl === "https://x/m.glb" && s.progress === 100;
  })(),
);
all &= t(
  "poll succeeded WITHOUT url → failed (not loading)",
  classifyPoll(200, { status: "succeeded" }).phase === "failed",
);
all &= t("poll pending stays pending", classifyPoll(200, { status: "pending" }).phase === "pending");
all &= t("poll 401 → unauthorized", classifyPoll(401, {}).phase === "unauthorized");
all &= t("poll 403 → failed (foreign job)", classifyPoll(403, {}).phase === "failed");
all &= t("poll 5xx junk → failed", classifyPoll(502, null).phase === "failed");

// ── isTerminal (retry streak semantics) ─────────────────────────────

all &= t(
  "single failed poll is retryable",
  !isTerminal({ phase: "failed", progress: 30 }, 1),
);
all &= t(
  "three consecutive failures terminate",
  isTerminal({ phase: "failed", progress: 30 }, 3),
);
all &= t("loading terminates the loop", isTerminal({ phase: "loading", progress: 100 }, 0));
all &= t("unauthorized terminates", isTerminal({ phase: "unauthorized", progress: 0 }, 0));
all &= t("generating keeps polling", !isTerminal({ phase: "generating", progress: 50 }, 0));

// ── poll schedule ───────────────────────────────────────────────────

all &= t("early polls are quick (2s)", pollDelayMs(0) === 2000 && pollDelayMs(3) === 2000);
all &= t("steady-state polls are 3.5s", pollDelayMs(4) === 3500 && pollDelayMs(40) === 3500);
all &= t(
  "give-up ceiling is sane (3–10 min)",
  MAX_POLL_MS >= 3 * 60_000 && MAX_POLL_MS <= 10 * 60_000,
);

// ── HMAC job-ownership tokens ───────────────────────────────────────

{
  const secret = "test-secret-key";
  const tok = await signJobToken("job-1", "user-a", secret);
  all &= t("token verifies for the creator", await verifyJobToken(tok, "job-1", "user-a", secret));
  all &= t(
    "token REJECTS a different user (no IDOR)",
    !(await verifyJobToken(tok, "job-1", "user-b", secret)),
  );
  all &= t(
    "token rejects a tampered jobId",
    !(await verifyJobToken(tok, "job-2", "user-a", secret)),
  );
  all &= t(
    "token rejects a wrong secret",
    !(await verifyJobToken(tok, "job-1", "user-a", "other-secret")),
  );
  all &= t("empty token rejects", !(await verifyJobToken("", "job-1", "user-a", secret)));
}

all &= t("uuid-ish jobId accepted", isValidJobId("0190a1b2-c3d4-7e8f-9012-3456789abcde"));
all &= t("path-traversal jobId rejected", !isValidJobId("../../etc/passwd"));
all &= t("too-short jobId rejected", !isValidJobId("abc"));

if (!all) {
  console.error("\njarvis-generate3d: FAILURES");
  process.exit(1);
}
console.log("\njarvis-generate3d: all tests passed");
