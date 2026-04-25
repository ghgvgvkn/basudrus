/**
 * App — screen router + providers + auth gate.
 *
 * Render order (outermost → inner):
 *   1. ErrorBoundary     — catches render crashes, shows fallback
 *   2. LocaleProvider    — EN/AR + direction
 *   3. AppProvider       — shared app state (screen, subscription, etc.)
 *   4. OnboardingGate    — forces first-run flow on new users
 *   5. SignInGate        — forces a real Supabase session for the shell
 *   6. Shell + Router    — the actual app
 *
 * The two gates are separate on purpose:
 *   - OnboardingGate cares about "has the user picked uni/major/year yet"
 *   - SignInGate cares about "is there a real auth.users row for this tab"
 * A user can be onboarded but signed-out (e.g. they cleared cookies). In
 * that case we skip onboarding but still force sign-in before Shell.
 */
import { lazy, Suspense } from "react";
import { AppProvider, useApp } from "@/context/AppContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { Shell } from "@/components/shell/Shell";
// HomeScreen stays eager — it's the default route every authed user
// lands on, so loading it inline keeps the first paint instant.
import { HomeScreen } from "@/features/home/HomeScreen";
import { SignInGate } from "@/features/auth/SignInGate";
import { ProfileSync } from "@/features/auth/ProfileSync";
import { QuizPrompt } from "@/features/match/QuizPrompt";

// Lazy-loaded routes — each becomes its own JS chunk that downloads
// only when the user navigates there. Cuts initial bundle ~60% for
// users who never open Subscription or Settings on first visit.
//
// React.lazy needs a default export. Our screens use named exports,
// so the .then() shim re-exposes the named export as `default`.
const DiscoverScreen      = lazy(() => import("@/features/discover/DiscoverScreen").then(m => ({ default: m.DiscoverScreen })));
const AIScreen            = lazy(() => import("@/features/ai/AIScreen").then(m => ({ default: m.AIScreen })));
const ConnectScreen       = lazy(() => import("@/features/messaging/ConnectScreen").then(m => ({ default: m.ConnectScreen })));
const RoomsScreen         = lazy(() => import("@/features/rooms/RoomsScreen").then(m => ({ default: m.RoomsScreen })));
const ProfileScreen       = lazy(() => import("@/features/profile/ProfileScreen").then(m => ({ default: m.ProfileScreen })));
const NotificationsScreen = lazy(() => import("@/features/notifications/NotificationsScreen").then(m => ({ default: m.NotificationsScreen })));
const SettingsScreen      = lazy(() => import("@/features/settings/SettingsScreen").then(m => ({ default: m.SettingsScreen })));
const SubscriptionScreen  = lazy(() => import("@/features/subscription/SubscriptionScreen").then(m => ({ default: m.SubscriptionScreen })));
const OnboardingScreen    = lazy(() => import("@/features/onboarding/OnboardingScreen").then(m => ({ default: m.OnboardingScreen })));

/** Tiny inline fallback shown for the ~50–200ms gap while a route's
 *  chunk downloads. Centered brand wordmark — matches the SignInGate
 *  loading state so transitions feel coherent. */
function RouteFallback() {
  return (
    <div className="min-h-[60dvh] grid place-items-center">
      <div className="font-serif italic text-2xl text-ink/30" style={{ letterSpacing: "-0.02em" }}>
        Bas Udrus
      </div>
    </div>
  );
}

function Router() {
  const { screen } = useApp();
  let view: React.ReactNode;
  switch (screen) {
    case "home":          view = <HomeScreen />; break;
    case "discover":      view = <DiscoverScreen />; break;
    case "ai":            view = <AIScreen />; break;
    case "connect":       view = <ConnectScreen />; break;
    case "rooms":         view = <RoomsScreen />; break;
    case "profile":       view = <ProfileScreen />; break;
    case "notifications": view = <NotificationsScreen />; break;
    case "settings":      view = <SettingsScreen />; break;
    case "subscription":  view = <SubscriptionScreen />; break;
    case "onboarding":    view = <OnboardingScreen />; break;
    default:              view = <HomeScreen />;
  }
  // Single Suspense wraps every lazy route. Using one boundary instead
  // of a per-route boundary preserves scroll position and avoids a
  // flicker when the user navigates between two lazy routes.
  return <Suspense fallback={<RouteFallback />}>{view}</Suspense>;
}

function AppGate() {
  const { onboardingComplete } = useApp();
  // New user: run onboarding (which includes the auth step). After
  // that, SignInGate picks up if the user is actually authed.
  // OnboardingScreen is lazy now, so wrap in Suspense.
  if (!onboardingComplete) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <OnboardingScreen />
      </Suspense>
    );
  }
  // Returning user: session might have expired or they cleared
  // cookies. SignInGate forces a fresh sign-in before any RLS-gated
  // screen renders. Without this, RLS denies reads silently and the
  // whole app looks "empty" even though everything is wired.
  return (
    <SignInGate>
      {/* ProfileSync keeps AppContext.profile in lockstep with the
          real Supabase row once we have a session, so the sidebar +
          Home greeting stop showing the seeded demo profile. */}
      <ProfileSync />
      {/* QuizPrompt detects users who haven't taken the personality
          quiz (either signed up before it existed, or skipped during
          onboarding) and shows them the quiz overlay. Auto-dismisses
          itself if the user completes or skips. */}
      <QuizPrompt />
      <Shell>
        <Router />
      </Shell>
    </SignInGate>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LocaleProvider>
        <AppProvider>
          <AppGate />
        </AppProvider>
      </LocaleProvider>
    </ErrorBoundary>
  );
}
