/**
 * SignInGate — email + password auth + "try as guest".
 *
 * Why not OTP: Supabase's free SMTP is rate-limited and the magic
 * link comes with the prod project's "Site URL" baked in — clicking
 * it lands on basudrus.com, not on this preview. We're in trial,
 * we just need a way in.
 *
 * Two paths:
 *   - Email + password (signUp creates account, signInWithPassword
 *     authenticates). No email delivery required. Works instantly.
 *   - "Try as guest" → supabase.auth.signInAnonymously() → real JWT,
 *     real session, RLS opens up. No email at all. Falls back to
 *     dismissing the gate if anon auth isn't enabled in the
 *     dashboard (the user just sees the empty states honestly).
 *
 * Same gate logic: blocks the Shell until a real session exists.
 */
import { useEffect, useState } from "react";
import { Mail, Lock, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSupabaseSession } from "./useSupabaseSession";

/** Legacy localStorage flag — kept only so we can clean it up on
 *  load. The bypass-auth path was REMOVED because it created a
 *  half-broken state: users dismissed the gate without a real
 *  session, then saw fake stub messages and empty Discover (RLS
 *  blocked all reads for the anon role). The whole app read as
 *  broken even though everything was wired correctly. Now it's
 *  real auth or nothing — much clearer for users, and the data
 *  actually shows up. */
const BYPASS_KEY_LEGACY = "bu:bypass-auth";

function clearLegacyBypass() {
  try { localStorage.removeItem(BYPASS_KEY_LEGACY); } catch { /* noop */ }
}

export function SignInGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useSupabaseSession();
  // PASSWORD_RECOVERY: Supabase fires this auth event when the user
  // clicks the password-reset link in their email. We intercept it
  // and show a "set new password" form INSTEAD of dropping them into
  // the app — otherwise they'd land in a half-authed state where
  // their session is valid but they don't yet know their new password.
  const [recoveringPassword, setRecoveringPassword] = useState(false);

  // Sweep any leftover bypass flag from previous sessions. Anyone
  // who was in bypass mode now sees the real sign-in form.
  useEffect(() => { clearLegacyBypass(); }, []);

  // Listen once for PASSWORD_RECOVERY. Doesn't fire on regular sign-in,
  // only after the magic-link click from a reset email.
  useEffect(() => {
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveringPassword(true);
        // Strip the recovery token from the URL hash so a refresh
        // doesn't re-trigger the flow.
        try {
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
        } catch { /* noop */ }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-bg">
        <div className="font-serif italic text-3xl text-ink/40" style={{ letterSpacing: "-0.02em" }}>
          Bas Udrus
        </div>
      </div>
    );
  }

  if (recoveringPassword) {
    return <NewPasswordForm onDone={() => setRecoveringPassword(false)} />;
  }

  // No real session = sign-in form. No bypass path. Real users
  // see real data; no fake stubs ever appear.
  if (!user) return <SignInForm />;

  return <>{children}</>;
}

function SignInForm() {
  // "reset" — request a password-reset email. The form stays on this
  // mode after submit (showing a success message) so the user knows
  // exactly what happened. They go back to "in" via the back link.
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!email.includes("@")) { setErr("Enter a valid email."); return; }
    if (mode !== "reset" && password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
      } else if (mode === "reset") {
        // The redirectTo URL is where Supabase sends the user after
        // they click the link in their email. Hash params on that URL
        // contain the recovery token; supabase-js fires the
        // PASSWORD_RECOVERY auth event automatically when it sees it.
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setResetSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setErr(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === "reset" ? (resetSent ? "Check your email" : "Reset your password") :
    mode === "up" ? "Join Bas Udrus" :
    "Welcome back";

  const subheading =
    mode === "reset"
      ? (resetSent
          ? `If an account exists for ${email.trim()}, we've sent a reset link. Click it from your inbox to set a new password.`
          : "Enter your email and we'll send you a link to set a new password.")
      : mode === "up"
        ? "Create an account so your study partners and progress are saved."
        : "Sign in to your account so your matches, rooms, and messages follow you.";

  return (
    <div className="min-h-dvh bg-bg text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="font-serif italic text-5xl leading-[1.02] mb-3" style={{ letterSpacing: "-0.02em" }}>
          {heading}
        </div>
        <p className="text-ink/60 mb-8">{subheading}</p>

        {/* Reset-success state: show a checkmark + "back to sign in" link
            instead of the form, so the user gets clear confirmation. */}
        {mode === "reset" && resetSent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-[#0E8A6B]/10 text-[#0E8A6B]">
              <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="text-sm">
                Reset email on its way. The link expires in about an hour — if you don't see it, check your spam folder.
              </div>
            </div>
            <button
              onClick={() => { setMode("in"); setResetSent(false); setErr(null); }}
              className="w-full h-12 rounded-full bg-ink text-bg font-medium hover:bg-ink/85 transition inline-flex items-center justify-center gap-2"
            >Back to sign in <ArrowRight size={16} /></button>
          </div>
        ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Email</span>
            <div className="relative">
              <Mail className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
              <input
                type="email"
                autoComplete="email"
                autoFocus={!email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="you@student.ju.edu.jo"
                className="w-full h-12 ps-11 pe-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
              />
            </div>
          </label>

          {/* Password field hidden in reset mode — the user is asking
              for an email link, not authenticating with a password. */}
          {mode !== "reset" && (
            <label className="block">
              <span className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Password</span>
              <div className="relative">
                <Lock className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
                <input
                  type="password"
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder={mode === "in" ? "Your password" : "At least 6 characters"}
                  minLength={6}
                  className="w-full h-12 ps-11 pe-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>
              {/* Forgot-password link sits under the password input only
                  in sign-in mode — sign-up doesn't need it. */}
              {mode === "in" && (
                <div className="mt-2 text-end">
                  <button
                    type="button"
                    onClick={() => { setMode("reset"); setErr(null); setPassword(""); }}
                    className="text-xs text-ink/55 hover:text-ink underline-offset-2 hover:underline"
                  >Forgot password?</button>
                </div>
              )}
            </label>
          )}

          {err && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#C23F6C]/10 text-[#C23F6C] text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <button
            onClick={submit}
            disabled={!email.includes("@") || (mode !== "reset" && password.length < 6) || busy}
            className="w-full h-12 rounded-full bg-ink text-bg font-medium disabled:opacity-30 hover:bg-ink/85 transition inline-flex items-center justify-center gap-2"
          >
            {busy
              ? (mode === "in" ? "Signing in…" : mode === "up" ? "Creating account…" : "Sending email…")
              : <>{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset email"} <ArrowRight size={16} /></>}
          </button>

          <p className="text-center text-sm text-ink/65 pt-1">
            {mode === "in" ? (
              <>Don't have an account?{" "}
                <button onClick={() => { setMode("up"); setErr(null); }} className="text-ink font-medium underline-offset-2 hover:underline">
                  Sign up
                </button>
              </>
            ) : mode === "up" ? (
              <>Already have an account?{" "}
                <button onClick={() => { setMode("in"); setErr(null); }} className="text-ink font-medium underline-offset-2 hover:underline">
                  Sign in
                </button>
              </>
            ) : (
              <>Remembered it?{" "}
                <button onClick={() => { setMode("in"); setErr(null); }} className="text-ink font-medium underline-offset-2 hover:underline">
                  Back to sign in
                </button>
              </>
            )}
          </p>
        </div>
        )}

        {/* "Try as guest" REMOVED — it created a half-broken state
            where users dismissed the gate without a real session,
            then saw fake stub data and empty Discover (RLS denied
            everything for the anon role). Real auth or nothing. */}
      </div>
    </div>
  );
}

/**
 * NewPasswordForm — shown after the user clicks the reset link in
 * their email. By the time we render this, supabase-js has already
 * exchanged the recovery token for a temporary session, so calling
 * `updateUser({ password })` will succeed under that session and the
 * user is fully signed in. We just hand them off to the app.
 */
function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr(null);
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      // Brief pause so the user sees the success state, then drop into the app.
      setTimeout(onDone, 1200);
    } catch (e) {
      setErr(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-bg text-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="font-serif italic text-5xl leading-[1.02] mb-3" style={{ letterSpacing: "-0.02em" }}>
          {done ? "All set" : "Set a new password"}
        </div>
        <p className="text-ink/60 mb-8">
          {done
            ? "Signing you in…"
            : "Choose something you'll remember. Min 6 characters."}
        </p>

        {done ? (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-[#0E8A6B]/10 text-[#0E8A6B]">
            <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="text-sm">Password updated.</div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">New password</span>
              <div className="relative">
                <Lock className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
                <input
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder="At least 6 characters"
                  minLength={6}
                  className="w-full h-12 ps-11 pe-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>
            </label>

            <label className="block">
              <span className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">Confirm</span>
              <div className="relative">
                <Lock className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder="Re-enter password"
                  className="w-full h-12 ps-11 pe-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>
            </label>

            {err && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#C23F6C]/10 text-[#C23F6C] text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <button
              onClick={submit}
              disabled={password.length < 6 || password !== confirm || busy}
              className="w-full h-12 rounded-full bg-ink text-bg font-medium disabled:opacity-30 hover:bg-ink/85 transition inline-flex items-center justify-center gap-2"
            >
              {busy ? "Saving…" : <>Save password <ArrowRight size={16} /></>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function friendlyAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Email or password isn't right.";
  if (lower.includes("user already registered")) return "Account exists — try signing in instead.";
  if (lower.includes("email not confirmed")) return "Confirm your email first, then sign in.";
  if (lower.includes("password should be at least")) return "Password must be at least 6 characters.";
  if (lower.includes("rate")) return "Too many attempts — wait a minute and try again.";
  if (lower.includes("network")) return "Network error. Check your connection.";
  if (lower.includes("anonymous") && lower.includes("disabled")) return "Guest mode isn't enabled — sign up with email instead.";
  return raw || "Something went wrong. Try again.";
}
