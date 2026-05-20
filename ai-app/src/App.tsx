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
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { SignInGate } from "@/features/auth/SignInGate";
import { ProfileSync } from "@/features/auth/ProfileSync";
import { SettingsButton } from "@ai/settings/SettingsButton";
import { SettingsModal } from "@ai/settings/SettingsModal";

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
              <AIScreen />
            </Suspense>
            {/* Floating cog + modal — AI-only, doesn't touch basudrus.com */}
            <SettingsButton />
            <SettingsModal />
          </SignInGate>
        </AppProvider>
      </LocaleProvider>
    </ErrorBoundary>
  );
}
