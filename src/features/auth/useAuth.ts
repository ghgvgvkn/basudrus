import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import { logError, trackEvent } from "@/services/analytics";

export function useAuth(
  loadProfile: (userId: string) => Promise<Profile | null>,
  loadAllStudents: () => Promise<void>,
) {
  const { user, setUser, profile, setProfile, setScreen, showNotif } = useApp();

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

  // ── Auth handler (signup / login) ──
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
        if (error) { setAuthError(error.message); setAuthLoading(false); return; }
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          setProfile(p => ({ ...p, name: authForm.name, email: authForm.email }));
          setScreen("onboard");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) { setAuthError(error.message); setAuthLoading(false); return; }
        if (data.user) {
          setUser({ id: data.user.id, email: data.user.email ?? "" });
          const p = await loadProfile(data.user.id);
          if (!p) {
            setScreen("onboard");
          } else {
            setScreen("discover");
          }
        }
      }
    } catch { setAuthError("Something went wrong — please try again"); }
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
      if (error) { setAuthError(error.message); setAuthLoading(false); }
    } catch { setAuthError("OAuth failed — please try again"); setAuthLoading(false); }
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
    if (!profile.uni || !profile.major || !profile.year) return showNotif("Almost there! Fill required fields 👆", "err");
    if (!user) { showNotif("Session expired — please sign in again", "err"); setScreen("auth"); return; }
    if (onboardLoading) return;
    setOnboardLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showNotif("Session expired — please sign in again", "err");
        setScreen("auth");
        setOnboardLoading(false);
        return;
      }
      const meta = session.user?.user_metadata;
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
      const { error } = await supabase.from("profiles").upsert(profileData, { onConflict: "id" });
      if (error) { logError("handleOnboard:upsert", error); showNotif("Error saving profile: " + error.message, "err"); setOnboardLoading(false); return; }
      setProfile(profileData as typeof profile);
      trackEvent("onboard_complete", { uni: profileData.uni, major: profileData.major });
      setScreen("discover");
      loadAllStudents().catch(e => logError("loadAllStudents", e));
    } catch (e) { logError("handleOnboard", e); showNotif("Something went wrong — please try again", "err"); }
    setOnboardLoading(false);
  };

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
