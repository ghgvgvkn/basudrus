/**
 * generate3d — pure client logic for the text-to-3D lifecycle.
 *
 * The fetch/React plumbing lives in useGenerate3D.ts; everything that
 * can be wrong in a subtle way (response classification, the poll
 * schedule, the give-up ceiling) lives HERE, dependency-free, so
 * scripts/tests/jarvis-generate3d.test.mjs imports the real source
 * under Node type stripping (zero drift — same pattern as gestures.ts
 * and explode.ts).
 *
 * Phases, in lifecycle order:
 *   creating       → POST in flight
 *   pending        → job queued upstream
 *   generating     → mesh building (REAL progress % from Meshy)
 *   loading        → .glb URL received, GLTF download/parse in flight
 *   ready          → model on screen
 * Terminal non-success:
 *   failed         → upstream failed / gave up / network died
 *   not_configured → MESHY_API_KEY not set server-side
 *   unauthorized   → no session (or it expired mid-flight)
 *   rate_limited   → create quota hit (message carries the copy)
 */

export type Gen3DPhase =
  | "creating"
  | "pending"
  | "generating"
  | "loading"
  | "ready"
  | "failed"
  | "not_configured"
  | "unauthorized"
  | "rate_limited";

export interface Gen3DStep {
  phase: Gen3DPhase;
  /** 0..100, REAL upstream progress (never decorative). */
  progress: number;
  jobId?: string;
  token?: string;
  modelUrl?: string;
  /** User-facing copy for terminal states. */
  message?: string;
}

/** Hard ceiling on total poll time before giving up. Meshy preview
 *  jobs usually land in 30-120s; past 5 minutes something is wrong. */
export const MAX_POLL_MS = 5 * 60_000;

/** Poll cadence: quick early checks (queue can clear fast), then a
 *  steady 3.5s so a 2-minute job costs ~40 polls. */
export function pollDelayMs(attempt: number): number {
  return attempt < 4 ? 2_000 : 3_500;
}

/** Classify the CREATE (POST) response into a lifecycle step. */
export function classifyCreate(httpStatus: number, body: unknown): Gen3DStep {
  const b = (body ?? {}) as {
    jobId?: unknown;
    token?: unknown;
    status?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (httpStatus === 401) {
    return { phase: "unauthorized", progress: 0, message: "Sign in to generate 3D models." };
  }
  if (httpStatus === 429) {
    const msg = typeof b.message === "string" ? b.message : "Generation limit reached — try again later.";
    return { phase: "rate_limited", progress: 0, message: msg };
  }
  if (b.status === "not_configured") {
    return {
      phase: "not_configured",
      progress: 0,
      message: "Live 3D generation isn't switched on yet — coming soon.",
    };
  }
  if (
    httpStatus === 200 &&
    b.status === "created" &&
    typeof b.jobId === "string" &&
    b.jobId.length > 0 &&
    typeof b.token === "string"
  ) {
    return { phase: "pending", progress: 0, jobId: b.jobId, token: b.token };
  }
  return { phase: "failed", progress: 0, message: "Couldn't start the build — try again." };
}

/** Classify a POLL (GET) response into a lifecycle step. */
export function classifyPoll(httpStatus: number, body: unknown): Gen3DStep {
  const b = (body ?? {}) as {
    status?: unknown;
    progress?: unknown;
    modelUrl?: unknown;
    message?: unknown;
  };
  if (httpStatus === 401) {
    return { phase: "unauthorized", progress: 0, message: "Session expired — sign in again." };
  }
  if (httpStatus === 403) {
    return { phase: "failed", progress: 0, message: "This build belongs to another session." };
  }
  const progress =
    typeof b.progress === "number" && Number.isFinite(b.progress)
      ? Math.max(0, Math.min(100, Math.round(b.progress)))
      : 0;
  if (b.status === "succeeded" && typeof b.modelUrl === "string" && b.modelUrl.length > 0) {
    return { phase: "loading", progress: 100, modelUrl: b.modelUrl };
  }
  if (b.status === "running") {
    return { phase: "generating", progress };
  }
  if (b.status === "pending") {
    return { phase: "pending", progress };
  }
  if (b.status === "not_configured") {
    return { phase: "not_configured", progress: 0, message: "Live 3D generation isn't switched on yet." };
  }
  // 429 on the loose poll bucket, 5xx, "failed", or junk — for a poll
  // mid-job a single hiccup shouldn't kill the build; the hook treats
  // failed-classified polls as retryable until MAX_POLL_MS.
  return { phase: "failed", progress, message: "The build hit a snag." };
}

/** True when a poll step should terminate the loop. A lone failed
 *  classification is retried (network blips, a 429 on the poll
 *  bucket); consecutiveFailures lets the hook stop after a streak. */
export function isTerminal(step: Gen3DStep, consecutiveFailures: number): boolean {
  switch (step.phase) {
    case "loading":
    case "ready":
    case "not_configured":
    case "unauthorized":
      return true;
    case "failed":
      return consecutiveFailures >= 3;
    default:
      return false;
  }
}
