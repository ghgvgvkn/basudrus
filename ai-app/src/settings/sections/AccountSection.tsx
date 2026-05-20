/**
 * AccountSection — name, email, university/major/year, password, sign-out.
 *
 * Reads from the live Supabase `profiles` row via useRealProfile, so any
 * edit on basudrus.com is reflected here and vice versa. Email is owned
 * by auth.users — we don't allow editing it inline (Supabase requires a
 * verification round trip), but we surface the "Change email" affordance.
 */
import { useEffect, useState } from "react";
import { Mail, Lock, GraduationCap, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession, signOutEverywhere } from "@/features/auth/useSupabaseSession";
import { useRealProfile } from "@/features/profile/useRealProfile";
import { Group, Field, GhostButton, Note } from "./parts";

export function AccountSection() {
  const { user } = useSupabaseSession();
  const { profile } = useRealProfile();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetErr, setResetErr] = useState<string>("");
  const [emailChangeState, setEmailChangeState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailChangeErr, setEmailChangeErr] = useState<string>("");
  const [newEmail, setNewEmail] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);

  // Reset transient state when section unmounts so a re-open starts clean.
  useEffect(() => {
    return () => { setResetState("idle"); setEmailChangeState("idle"); setShowEmailForm(false); };
  }, []);

  const handleSendReset = async () => {
    if (!user?.email) return;
    setResetState("sending");
    setResetErr("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (error) { setResetErr(error.message); setResetState("error"); }
      else { setResetState("sent"); }
    } catch (e) {
      setResetErr(e instanceof Error ? e.message : "Failed to send reset email");
      setResetState("error");
    }
  };

  const handleChangeEmail = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setEmailChangeErr("Enter a valid email address");
      setEmailChangeState("error");
      return;
    }
    setEmailChangeState("sending");
    setEmailChangeErr("");
    try {
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) { setEmailChangeErr(error.message); setEmailChangeState("error"); }
      else {
        setEmailChangeState("sent");
        setNewEmail("");
      }
    } catch (e) {
      setEmailChangeErr(e instanceof Error ? e.message : "Failed to update email");
      setEmailChangeState("error");
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutEverywhere();
      // SIGNED_OUT listener in the shared session hook reloads the app
      // back to the sign-in gate within ~100ms.
    } finally {
      setSigningOut(false);
      setConfirmSignOut(false);
    }
  };

  const displayName = profile?.name || user?.email?.split("@")[0] || "—";
  const eduLine = [profile?.uni, profile?.major, profile?.year ? `Year ${profile.year}` : null]
    .filter(Boolean)
    .join(" · ") || "Not set";

  return (
    <>
      <Group title="Identity">
        <Field
          label="Name"
          value={displayName}
          sublabel="Visible to study partners on Bas Udrus"
        />
        <Field
          label="Email"
          value={user?.email ?? "—"}
          sublabel="Used for sign-in and notifications"
          action={
            <GhostButton onClick={() => setShowEmailForm((v) => !v)}>
              <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Change</span>
            </GhostButton>
          }
        />
        {showEmailForm && (
          <div className="px-4 py-3 bg-surface-1">
            <label className="block text-xs text-ink-3 mb-1.5">New email address</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@university.edu"
                disabled={emailChangeState === "sending"}
                className="flex-1 h-9 px-3 rounded-lg bg-surface-2 text-sm text-ink-1 border border-line/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <button
                onClick={handleChangeEmail}
                disabled={emailChangeState === "sending" || !newEmail.trim()}
                className="h-9 px-3 rounded-lg bg-ink-1 text-surface-1 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {emailChangeState === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {emailChangeState === "sending" ? "Sending…" : "Send link"}
              </button>
            </div>
            {emailChangeState === "sent" && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                Confirmation sent. Click the link in your new inbox to finish the switch.
              </p>
            )}
            {emailChangeState === "error" && (
              <p className="mt-2 text-xs text-red-600">{emailChangeErr || "Couldn't update email"}</p>
            )}
          </div>
        )}
      </Group>

      <Group title="Education" hint="Edit on basudrus.com → Profile">
        <Field
          label="University, major, year"
          value={eduLine}
          sublabel="Powers tutor personalisation and matches"
        />
      </Group>

      <Group title="Security">
        <Field
          label="Password"
          value={resetState === "sent" ? "Reset link sent — check your email" : "••••••••"}
          sublabel="Reset by email link — we don't store your password"
          action={
            <GhostButton
              onClick={handleSendReset}
              disabled={resetState === "sending" || !user?.email}
            >
              <span className="inline-flex items-center gap-1.5">
                {resetState === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {resetState === "sending" ? "Sending…" : resetState === "sent" ? "Sent ✓" : "Reset password"}
              </span>
            </GhostButton>
          }
        />
        {resetState === "error" && (
          <div className="px-4 pb-3">
            <Note tone="warn">Couldn't send reset email: {resetErr}</Note>
          </div>
        )}
      </Group>

      <Group title="Session">
        <div className="px-4 py-3.5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink-1 font-medium">Sign out</div>
            <div className="text-xs text-ink-3 mt-0.5">Signs you out of all devices and clears the cookie shared with basudrus.com.</div>
          </div>
          <div className="shrink-0">
            {confirmSignOut ? (
              <div className="flex items-center gap-2">
                <GhostButton onClick={() => setConfirmSignOut(false)} disabled={signingOut}>Cancel</GhostButton>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="h-9 px-3.5 rounded-full bg-red-500 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {signingOut && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {signingOut ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            ) : (
              <GhostButton tone="danger" onClick={() => setConfirmSignOut(true)}>
                <span className="inline-flex items-center gap-1.5"><LogOut className="h-3.5 w-3.5" /> Sign out</span>
              </GhostButton>
            )}
          </div>
        </div>
      </Group>

      <Note tone="info">
        <span className="inline-flex items-start gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>This account is shared with basudrus.com. Changes here apply to both — your profile, matches, rooms, and messages stay in sync.</span>
        </span>
      </Note>
    </>
  );
}
