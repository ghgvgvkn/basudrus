/**
 * AuroraSignUpModal — Aurora-styled sign-up / sign-in overlay.
 *
 * Opens when an anonymous visitor tries to do something that needs an
 * account (send a message, hold the mic). The modal is a glassmorphic
 * card layered on top of the canvas — same aesthetic as the rest of
 * Aurora, no jarring color swap.
 *
 * Flow:
 *   1. Visitor lands on ai.basudrus.com → sees full Aurora canvas, can
 *      look around. No sign-in wall.
 *   2. Visitor types a message + presses send (or holds the mic).
 *      AuroraAIScreen sees no user → opens this modal AND stashes
 *      the message in pendingMessage state.
 *   3. Modal shows "Sign up to chat with Aurora — Tony's ready."
 *      Plus their queued message echoed below so they remember what
 *      they were about to ask.
 *   4. They sign up via Google or email/password.
 *   5. supabase.auth.onAuthStateChange fires SIGNED_IN.
 *   6. AuroraAIScreen's useSupabaseSession picks up the new user,
 *      closes the modal, and auto-sends the pending message.
 *   7. Tony replies as usual.
 *
 * The modal does its own auth calls (signInWithOAuth + signInWithPassword
 * + signUp). Doesn't share state with the legacy SignInGate, which
 * isn't mounted on Aurora.
 *
 * Style is intentionally distinct from the cream-token SignInForm —
 * dark glass + Aurora's palette so it feels like part of the canvas.
 */
import { useState } from "react";
import { Mail, Lock, ArrowRight, AlertCircle, X, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { setOauthOrigin } from "@/lib/oauthOrigin";

type Mode = "up" | "in";

export interface AuroraSignUpModalProps {
  /** True when the modal is mounted + visible. */
  open: boolean;
  /** Called when the user clicks the X or hits Escape. */
  onClose: () => void;
  /** The message the user typed before being asked to sign up.
   *  We echo it back in the modal so the user remembers why they're
   *  signing up. AuroraAIScreen auto-sends it after auth. */
  pendingMessage?: string;
}

export function AuroraSignUpModal({ open, onClose, pendingMessage }: AuroraSignUpModalProps) {
  // Default mode = "up" because the modal is primarily a new-user
  // funnel. Users with existing accounts can toggle to "in".
  const [mode, setMode] = useState<Mode>("up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  /**
   * Google sign-in — branches on the current host.
   *
   * (1) Production *.basudrus.com (e.g. ai.basudrus.com):
   *     Redirect through basudrus.com's auth hub. The session cookie
   *     is scoped to .basudrus.com so it travels back to the AI
   *     subdomain after sign-in. Doesn't need any Supabase config
   *     changes — uses the existing working basudrus.com flow.
   *
   * (2) Preview / staging (basudrus-ai.vercel.app, localhost, etc.):
   *     basudrus.com's cookie CAN'T reach .vercel.app — they're
   *     different cookie domains. So the hub redirect would
   *     log them in on basudrus.com but they'd return to
   *     basudrus-ai.vercel.app with no session.
   *
   *     Instead, do a direct supabase.auth.signInWithOAuth with
   *     redirectTo = current origin. This requires Supabase's
   *     Redirect URLs allowlist to include the current host
   *     (e.g. https://basudrus-ai.vercel.app/** — easy to add,
   *     same as the existing basudrus-*-ghgvgvkns wildcard).
   *
   * Why not always use #2? Because basudrus.com's Supabase config
   * might not allowlist every basudrus subdomain. The hub redirect
   * (#1) is unconditional — once they sign in on basudrus.com, the
   * cookie SSO trick takes them anywhere on .basudrus.com.
   */
  const signInWithGoogle = async () => {
    setErr(null);
    setGoogleBusy(true);

    const onBasudrusCom = /(^|\.)basudrus\.com$/i.test(window.location.hostname);

    // Always save the origin marker first — works for both paths.
    setOauthOrigin(window.location.origin);

    if (onBasudrusCom) {
      // Path 1: production .basudrus.com — auth hub redirect.
      window.location.href = "https://basudrus.com/?signin=google";
      return;
    }

    // Path 2: preview / staging / localhost — direct OAuth, redirect
    // back to ourselves. Cookie can't cross to .basudrus.com so the
    // hub strategy doesn't work here.
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      // Redirect takes over; we don't reach this line.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed.";
      setErr(
        /provider.*disabled|not enabled|Unsupported provider/i.test(msg)
          ? "Google sign-in isn't available right now — try email below."
          : /redirect.*allowed|invalid.*redirect/i.test(msg)
            ? "This preview URL isn't allowlisted yet in Supabase. Use email/password below, or open basudrus.com directly."
            : msg,
      );
      setGoogleBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email.includes("@")) { setErr("Enter a valid email."); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // signUp may require email confirmation depending on Supabase
        // settings — if confirmation is OFF, the SIGNED_IN event fires
        // immediately and AuroraAIScreen closes us + retries pending.
        // If confirmation is ON, the user has to click the link in
        // their email; we show a success message in that case.
        setErr(null);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (e2) {
      setErr(friendlyAuthError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aurora-signup-backdrop" onClick={(e) => {
      // Click outside the card closes the modal — same UX as a
      // typical dismiss-on-backdrop overlay.
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="aurora-signup-card" role="dialog" aria-modal="true">
        {/* Close X — top-right of the card */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="aurora-signup-close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Heading */}
        <div className="aurora-signup-header">
          <div className="aurora-signup-pip">
            <span className="aurora-ring" />
            <span className="aurora-ring aurora-d" />
            <span className="aurora-pip" />
          </div>
          <h2 className="aurora-signup-title">
            {mode === "up" ? "Sign up to chat with Aurora" : "Welcome back"}
          </h2>
          <p className="aurora-signup-sub">
            {mode === "up"
              ? "Tony remembers your courses, professors and what you're studying. Free for 30 messages a day."
              : "Sign in to pick up where you left off with Tony."}
          </p>
        </div>

        {/* Pending message echo — gives the user context for WHY they
            were asked to sign up. */}
        {pendingMessage && (
          <div className="aurora-signup-pending">
            <span className="aurora-signup-pending-label">YOUR MESSAGE</span>
            <div className="aurora-signup-pending-bubble">{pendingMessage}</div>
            <span className="aurora-signup-pending-foot">
              <Sparkles className="h-3 w-3" /> Tony will reply right after you sign{mode === "up" ? " up" : " in"}.
            </span>
          </div>
        )}

        {/* Google button — wide, prominent */}
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleBusy || busy}
          className="aurora-signup-google"
        >
          <GoogleIcon />
          <span>{googleBusy ? "Opening Google…" : "Continue with Google"}</span>
        </button>

        {/* Divider */}
        <div className="aurora-signup-divider">
          <span>or with email</span>
        </div>

        {/* Email + password form */}
        <form onSubmit={submit} className="aurora-signup-form">
          <label className="aurora-signup-field">
            <Mail className="aurora-signup-field-icon" />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              disabled={busy || googleBusy}
            />
          </label>
          <label className="aurora-signup-field">
            <Lock className="aurora-signup-field-icon" />
            <input
              type="password"
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "up" ? "Pick a password (6+ chars)" : "Your password"}
              disabled={busy || googleBusy}
            />
          </label>
          {err && (
            <div className="aurora-signup-error">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={busy || googleBusy}
            className="aurora-signup-submit"
          >
            <span>{busy ? (mode === "up" ? "Creating account…" : "Signing in…") : (mode === "up" ? "Sign up — free" : "Sign in")}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Mode toggle */}
        <div className="aurora-signup-toggle">
          {mode === "up" ? (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => { setMode("in"); setErr(null); }}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" onClick={() => { setMode("up"); setErr(null); }}>
                Sign up
              </button>
            </>
          )}
        </div>

        <p className="aurora-signup-tos">
          By continuing you agree to Bas Udrus's terms. We never share your study data.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function friendlyAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials|invalid.*password/i.test(msg)) {
    return "Wrong email or password.";
  }
  if (/user already registered|already registered/i.test(msg)) {
    return "That email's already registered. Try signing in instead.";
  }
  if (/rate.limit/i.test(msg)) {
    return "Too many attempts — wait a minute and try again.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Check your inbox for the confirmation email.";
  }
  return msg;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.44 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.37c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.37 12 5.37z" />
    </svg>
  );
}
