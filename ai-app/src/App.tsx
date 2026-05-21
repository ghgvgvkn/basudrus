/**
 * ai-app — minimal AI-only shell.
 *
 * Mirrors the provider stack from Bas Udrus's App.tsx but skips the
 * Router, Shell, Onboarding gate, and every non-AI screen. The only
 * thing this app does is:
 *   1. Wrap in the same providers Bas Udrus uses (so all shared hooks
 *      from @/context/AppContext + @/context/LocaleContext work).
 *   2. Force a Supabase sign-in via SignInGate.
 *   3. Render <AIScreen /> full-bleed.
 *
 * Because we share the supabase client (with the new cookie storage
 * scoped to .basudrus.com), a user signed into basudrus.com is
 * automatically signed in here. SignInGate falls through.
 *
 * Everything ai-app does beyond this — voice mode, Harvey persona,
 * 3D Jarvis view, immersive shell — lives in @ai/* files we'll add
 * incrementally. The base case (this file) ships a working chat now.
 */
import { Suspense, lazy } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { SignInGate } from "@/features/auth/SignInGate";
import { ProfileSync } from "@/features/auth/ProfileSync";
import { SettingsButton } from "@ai/settings/SettingsButton";
import { SettingsModal } from "@ai/settings/SettingsModal";
import { VoiceDock } from "./voice/VoiceDock";

// AIScreen is heavy (1980 LOC + artifact components). Lazy so first paint
// is the auth gate, not the chat shell.
const AIScreen = lazy(() =>
  import("@/features/ai/AIScreen").then((m) => ({ default: m.AIScreen })),
);

function LoadingShell() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-bg">
      <div
        className="font-serif italic text-2xl text-ink/30"
        style={{ letterSpacing: "-0.02em" }}
      >
        Bas Udrus AI
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LocaleProvider>
        <AppProvider>
          <SignInGate>
            <ProfileSync />
            <Suspense fallback={<LoadingShell />}>
              {/* Settings cog is injected inline into AIScreen's header
                  row (after QuotaChip + Go Pro) via the headerEnd prop.
                  Bas Udrus's render of <AIScreen /> doesn't pass anything,
                  so the cog is AI-only.

                  fillViewport claims the full dvh — Bas Udrus's AIScreen
                  reserves 56/64px for its top bar + bottom nav, but
                  ai-app has neither, so we close that gap so the
                  composer sits at the real viewport bottom instead of
                  floating 56px above it. */}
              <AIScreen headerEnd={<SettingsButton />} fillViewport />
            </Suspense>
            {/* Modal is rendered as a portal-like overlay — its position
                in the tree doesn't matter, it's `position: fixed`. */}
            <SettingsModal />
            {/* ElevenLabs voice dock — bottom-right floating control.
                Owns the useVoice() hook and writes transcribed speech
                into aiPrefill on AppContext, which AIScreen's existing
                useEffect consumes to populate the composer draft.
                Doesn't modify AIScreen — voice ships TODAY as a clean
                add-on, future inline-per-message + auto-speak features
                can be wired in once we've validated the foundation. */}
            <VoiceDock />
          </SignInGate>
        </AppProvider>
      </LocaleProvider>
      {/* Vercel Speed Insights — Core Web Vitals on ai.basudrus.com.
          Outside SignInGate so we still capture LCP/TTFB for the
          auth-gate paint (which IS the first paint for new visitors). */}
      <SpeedInsights />
    </ErrorBoundary>
  );
}
