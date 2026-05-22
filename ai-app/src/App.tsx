/**
 * ai-app — Aurora AI shell (anonymous-browsable).
 *
 * Key UX decision: visitors can BROWSE Aurora without signing in.
 * The full canvas, chrome, and chat composer render publicly. Only
 * when an anonymous user tries to actually send a message (or use
 * the mic) does AuroraAIScreen open the inline AuroraSignUpModal.
 *
 * Why we removed SignInGate from this shell:
 *   - Better first-impression UX — visitors see the product immediately
 *     instead of an auth wall before they understand what it does.
 *   - "Twitter/X" pattern — browse freely, sign up at the moment of
 *     intent (send a message, save, follow). Conversion lifts.
 *   - Cross-subdomain SSO still works — when a signed-in basudrus.com
 *     user lands here, the .basudrus.com-scoped cookie is picked up
 *     by the supabase client and useSupabaseSession sees them as
 *     authed without any redirect.
 *
 * IMPORTANT: ai.basudrus.com is branded "Aurora" — but the AI persona
 * itself stays "Tony Starrk" (system prompt in api/ai/tutor.ts is
 * unchanged). Aurora is the PLATFORM; Tony is the AI inside it.
 *
 * The shared src/features/ai/AIScreen.tsx (used by basudrus.com) is
 * NOT touched. basudrus.com keeps its existing auth-gated flow.
 */
import { Suspense, lazy } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { ProfileSync } from "@/features/auth/ProfileSync";
import { SettingsModal } from "@ai/settings/SettingsModal";

// AuroraAIScreen — anonymous-renderable. Authed paths gated inside
// the component, not at the route level.
const AuroraAIScreen = lazy(() =>
  import("./aurora/AuroraAIScreen").then((m) => ({ default: m.AuroraAIScreen })),
);

function LoadingShell() {
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
          {/* ProfileSync is safe to mount unconditionally — it
              internally checks for a session and no-ops without one.
              When the user eventually signs in via the modal, it
              picks up the new session via supabase.auth state
              changes and syncs their profile into AppContext. */}
          <ProfileSync />
          <Suspense fallback={<LoadingShell />}>
            <AuroraAIScreen />
          </Suspense>
          {/* Settings modal — only ever opens when an authed user
              clicks the cog inside Aurora. Safe to keep mounted
              globally as a portal-style overlay. */}
          <SettingsModal />
        </AppProvider>
      </LocaleProvider>
      <SpeedInsights />
    </ErrorBoundary>
  );
}
