import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError, trackEvent } from "@/services/analytics";

export function useAuth(
  loadProfile: (userId: string) => Promise<Profile | null>,
  loadAllStudents: () => Promise<void>,
) {
  const { user, setUser, profile, setProfile, setScreen, showNotif, screen } = useApp();

  const [authMode, setAuthMode] = useState<"signup"|"login"|"reset"|"reset-sent"|"new-password">("signup");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // ── Onboard state ──
  const [onboardMajorSearch, setOnboardMajorSearch] = useState("");
  const [onboardMajorOpen, setOnboardMajorOpen] = useState(false);
  const onboardMajorRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [onboardLoading, setOnboardLoading] = useState(false);

  // ── Onboarding funnel telemetry ──
  // 6 users in the last 48h signed up but never completed onboarding — we can
  // only guess why. Adding funnel events lets us see where they drop:
  //   onboard_view     — landed on the screen
  //   onboard_step2    — clicked Next after step 1
  //   onboard_complete — saved profile (already tracked in handleOnboard)
  //   onboard_fail     — explicit error (already tracked)
  // Gap between view → step2 = step 1 friction. Gap step2 → complete = step 2.
  // Closed-tab users are invisible but we'll have the view event at least.
  const onboardViewFired = useRef(false);
  useEffect(() => {
    if (screen === "onboard" && !onboardViewFired.current) {
      onboardViewFired.current = true;
      trackEvent("onboard_view", {
        has_name: !!profile.name,
        has_uni: !!profile.uni,
        has_major: !!profile.major,
      });
    }
    if (screen !== "onboard") onboardViewFired.current = false;
  }, [screen, profile.name, profile.uni, profile.major]);

  const onboardStep2Fired = useRef(false);
  useEffect(() => {
    if (screen === "onboard" && step === 2 && !onboardStep2Fired.current) {
      onboardStep2Fired.current = true;
      trackEvent("onboard_step2");
    }
    if (step === 1) onboardStep2Fired.current = false;
  }, [screen, step]);

  // ── Auth handler (signup / login) ──
  // Friendly-translate common Supabase auth errors (the default messages are
  // unclear to non-developers). Falls through with the original text for rare ones.
  const friendlyAuthError = (raw: string): string => {
    const m = raw.toLowerCase();
    if (m.includes("invalid login") || m.includes("invalid credentials")) return "Wrong email or password. Double-check and try again.";
    if (m.includes("user already registered") || m.includes("already been registered")) return "This email is already registered. Try logging in instead.";
    if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox.";
    if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
    if (m.includes("password should be") || m.includes("password is too")) return "Password must be at least 6 characters.";
    if (m.includes("signup disabled") || m.includes("signups not allowed")) return "Signups are temporarily disabled. Please try again later.";
    if (m.includes("network") || m.includes("fetch") || m.includes("load failed")) return "Connection issue. Check your internet and try again.";
    return raw;
  };

  const handleAuth = async () => {
    setAuthError("");
    if (!authForm.email || !authForm.password) return setAuthError("Please fill all fields.");
    if (!authForm.email.includes("@")) return setAuthError("Enter a valid email address.");
    if (authForm.password.length < 6) return setAuthError("Password must be at least 6 characters.");
    if (authMode === "signup" && !authForm.name) return setAuthError("Enter your full name.");
    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) {
          setAuthError(friendlyAuthError(error.message));
          trackEvent("auth_fail", { mode: "signup", reason: error.message.slice(0, 100) });
          setAuthLoading(false); return;
        }
        if (data.user) {
          // If Supabase is set to require email confirmation, data.session will
          // be null — the user ISN'T actually signed in yet. Tell them to check
          // their email instead of pushing to onboarding where their upsert
          // would silently fail.
          if (!data.session) {
            setAuthError("Almost there! Check your email and click the confirmation link to finish signing up.");
            trackEvent("auth_pending", { mode: "signup_email_confirm" });
            setAuthLoading(false);
            return;
          }
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          setProfile(p => ({ ...p, name: authForm.name, email: authForm.email }));
          setScreen("onboard");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) {
          setAuthError(friendlyAuthError(error.message));
          trackEvent("auth_fail", { mode: "signin", reason: error.message.slice(0, 100) });
          setAuthLoading(false); return;
        }
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          // Note: onAuthStateChange SIGNED_IN handler will run loadProfile
          // and set the screen. Avoid calling loadProfile here to prevent
          // concurrent auth token lock contention on slow connections.
        }
      }
    } catch (e) {
      logError("handleAuth", e);
      setAuthError("Something went wrong — please try again");
      trackEvent("auth_fail", { mode: authMode, reason: "exception" });
    }
    setAuthLoading(false);
  };

  // ── OAuth ──
  const handleOAuth = async (provider: "google" | "apple") => {
    setAuthError("");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) {
        setAuthError(friendlyAuthError(error.message));
        trackEvent("auth_fail", { mode: "oauth_" + provider, reason: error.message.slice(0, 100) });
        setAuthLoading(false);
      }
    } catch (e) {
      logError("handleOAuth", e);
      setAuthError("OAuth failed — please try again");
      trackEvent("auth_fail", { mode: "oauth_" + provider, reason: "exception" });
      setAuthLoading(false);
    }
  };

  // ── Reset password (step 1: send email) ──
  const handleResetPassword = async () => {
    setAuthError("");
    if (!resetEmail.includes("@")) return setAuthError("Enter a valid email address.");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) { setAuthError(error.message); }
      else { setAuthMode("reset-sent"); }
    } catch { setAuthError("Failed — please try again"); }
    setAuthLoading(false);
  };

  // ── Reset password (step 2: set new password after redirect) ──
  const handleNewPassword = async () => {
    setAuthError("");
    if (newPassword.length < 6) return setAuthError("Password must be at least 6 characters.");
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) { setAuthError(error.message); setAuthLoading(false); return; }
      setNewPassword("");
      showNotif("Password updated! You're logged in.", "ok");
      if (user) await loadProfile(user.id);
      setScreen("discover");
    } catch { setAuthError("Failed — please try again"); }
    setAuthLoading(false);
  };

  // ── Onboard ──
  const handleOnboard = async () => {
    if (!profile.uni || !profile.major || !profile.year) {
      const missing = [!profile.uni && "university", !profile.major && "major", !profile.year && "year"].filter(Boolean).join(", ");
      showNotif(`Almost there! Still need: ${missing} 👆`, "err");
      trackEvent("onboard_fail", { reason: "missing_fields", missing });
      return;
    }
    if (!user) { showNotif("Session expired — please sign in again", "err"); setScreen("auth"); return; }
    if (onboardLoading) return;
    setOnboardLoading(true);
    // Persist in-progress onboarding to localStorage so closing the tab mid-flow
    // doesn't lose their uni/major/year. Restored on next sign-in below.
    try {
      localStorage.setItem("bu:onboard-draft", JSON.stringify({
        uni: profile.uni, major: profile.major, year: profile.year,
        meet_type: profile.meet_type, bio: profile.bio,
        ts: Date.now(),
      }));
    } catch { /* storage unavailable, not critical */ }
    try {
      // Race session lookup against a 3s timeout; if getSession() hangs (IndexedDB
      // lock contention with other concurrent auth calls), fall back to the user
      // already in React state. Upsert will still include the auth token.
      const sessionPromise = supabase.auth.getSession().then(r => r.data.session).catch(() => null);
      const session = await Promise.race([
        sessionPromise,
        new Promise<null>(r => setTimeout(() => r(null), 3000)),
      ]);
      const meta = session?.user?.user_metadata;
      const bestName = profile.name || authForm.name || meta?.full_name || meta?.name || user.email.split("@")[0];
      const oauthAvatar = meta?.avatar_url || meta?.picture || null;
      const profileData: Record<string, unknown> = {
        id: user.id,
        email: user.email,
        name: bestName,
        uni: profile.uni,
        major: profile.major,
        year: profile.year,
        course: profile.course || "",
        meet_type: profile.meet_type || "flexible",
        bio: profile.bio || "",
        avatar_emoji: profile.avatar_emoji || "🫶",
        avatar_color: profile.avatar_color || "#6C8EF5",
        photo_mode: oauthAvatar ? "photo" : "initials",
        photo_url: oauthAvatar || null,
        streak: 0,
        xp: 0,
        badges: [],
        online: true,
        sessions: 0,
        rating: 0,
        subjects: [],
      };
      // Retry upsert up to 3 times for transient network errors (esp. mobile Safari)
      let upsertError: { message?: string; code?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.from("profiles").upsert(profileData, { onConflict: "id" });
        upsertError = error;
        if (!error) break;
        const msg = (error.message || "").toLowerCase();
        const isTransient = msg.includes("load failed") || msg.includes("fetch") || msg.includes("network") || msg.includes("timeout") || !navigator.onLine;
        if (!isTransient) break;
        const { data: { session: s2 } } = await supabase.auth.getSession();
        if (!s2) { await supabase.auth.refreshSession().catch(()=>{}); }
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
      if (upsertError) {
        logError("handleOnboard:upsert", upsertError);
        trackEvent("onboard_fail", { reason: (upsertError.message || "upsert_error").slice(0, 100) });
        showNotif("Error saving profile: " + upsertError.message + " — check your connection and retry", "err");
        setOnboardLoading(false);
        return;
      }
      setProfile(profileData as typeof profile);
      trackEvent("onboard_complete", { uni: profileData.uni, major: profileData.major });
      // Successful save — clear the draft so it doesn't rehydrate over a real profile
      try { localStorage.removeItem("bu:onboard-draft"); } catch { /* ignore */ }
      setScreen("discover");
      loadAllStudents().catch(e => logError("loadAllStudents", e));
    } catch (e) {
      logError("handleOnboard", e);
      trackEvent("onboard_fail", { reason: "exception" });
      showNotif("Something went wrong — please try again", "err");
    }
    setOnboardLoading(false);
  };

  // Rehydrate onboarding draft when a signed-in user lands on the onboard screen
  // with empty fields (e.g. they closed the tab mid-flow and came back). Runs once
  // per sign-in. Safe: only fills blanks, never overwrites existing values.
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem("bu:onboard-draft");
      if (!raw) return;
      const draft = JSON.parse(raw) as { uni?: string; major?: string; year?: string; meet_type?: string; bio?: string; ts?: number };
      // Drafts older than 7 days are stale — drop them.
      if (draft.ts && Date.now() - draft.ts > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem("bu:onboard-draft");
        return;
      }
      setProfile(p => ({
        ...p,
        uni: p.uni || draft.uni || "",
        major: p.major || draft.major || "",
        year: p.year || draft.year || "",
        meet_type: p.meet_type || draft.meet_type || "flexible",
        bio: p.bio || draft.bio || "",
      }));
    } catch { /* corrupted draft — ignore */ }
  }, [user?.id]);

  return {
    authMode, setAuthMode,
    authForm, setAuthForm,
    authError, setAuthError,
    authLoading,
    resetEmail, setResetEmail,
    newPassword, setNewPassword,
    onboardMajorSearch, setOnboardMajorSearch,
    onboardMajorOpen, setOnboardMajorOpen,
    onboardMajorRef,
    step, setStep,
    onboardLoading,
    handleAuth, handleOAuth, handleResetPassword, handleNewPassword, handleOnboard,
  };
}
