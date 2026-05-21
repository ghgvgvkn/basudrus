/**
 * ai-app — Aurora AI shell.
 *
 * Mirrors the provider stack from Bas Udrus's App.tsx but skips the
 * Router, Shell, Onboarding gate, and every non-AI screen. The only
 * thing this app does is:
 *   1. Wrap in the same providers Bas Udrus uses (so all shared hooks
 *      from @/context/AppContext + @/context/LocaleContext work).
 *   2. Force a Supabase sign-in via SignInGate.
 *   3. Render <AuroraAIScreen /> full-bleed.
 *
 * Because we share the supabase client (with the new cookie storage
 * scoped to .basudrus.com), a user signed into basudrus.com is
 * automatically signed in here. SignInGate falls through.
 *
 * IMPORTANT: ai.basudrus.com is branded "Aurora" — but the AI persona
 * itself stays "Tony Starrk" (system prompt in api/ai/tutor.ts is
 * unchanged). Aurora is the PLATFORM; Tony is the AI inside it.
 *
 * The shared src/features/ai/AIScreen.tsx (used by basudrus.com) is
 * NOT touched by the Aurora redesign — basudrus.com keeps its existing
 * look and behavior.
 */
import { Suspense, lazy } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { SignInGate } from "@/features/auth/SignInGate";
import { ProfileSync } from "@/features/auth/ProfileSync";
import { SettingsModal } from "@ai/settings/SettingsModal";

// AuroraAIScreen replaces the legacy <AIScreen /> on ai.basudrus.com.
// Lazy-loaded so the auth gate paints before the canvas + chrome
// download. The Aurora chunk is ~30 KB including the dot-matrix
// engine + ported CSS.
const AuroraAIScreen = lazy(() =>
  import("./aurora/AuroraAIScreen").then((m) => ({ default: m.AuroraAIScreen })),
);

function LoadingShell() {
  // Match Aurora's deep-navy background so the loading paint doesn't
  // flash cream → black on a freshly opened tab.
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(ellipse at 50% 30%, #14143F 0%, #0A0A36 55%, #050524 100%)",
      }}
    >
      <div
        style={{
          fontFamily: "'Urbanist', system-ui, sans-serif",
          color: "rgba(255,255,255,0.55)",
          letterSpacing: "0.04em",
          fontSize: "20px",
          fontWeight: 300,
        }}
      >
        Aurora
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
              <AuroraAIScreen />
            </Suspense>
            {/* Settings modal stays mounted as a portal-style overlay —
                its visibility is driven by global state from
                SettingsButton (clicked from inside Aurora's top-right
                chrome). The modal's 8 sections still work; only its
                trigger location changed. */}
            <SettingsModal />
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
