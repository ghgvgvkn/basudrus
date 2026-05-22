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
import { setOauthOrigin, readOauthOrigin, clearOauthOrigin } from "@/lib/oauthOrigin";
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

  /**
   * Cross-subdomain OAuth bounce-back.
   *
   * When a user starts Google sign-in on ai.basudrus.com but Supabase's
   * Redirect URL allowlist doesn't whitelist that origin, Supabase
   * silently redirects them to the Site URL (basudrus.com) after the
   * OAuth handshake. The session DOES get established (cookie scoped
   * to .basudrus.com is set), but the user lands on the wrong domain.
   *
   * Before signing in, signInWithGoogle stores window.location.origin
   * in localStorage. On the page that ACTUALLY receives the callback,
   * we check that flag — if a session exists AND the saved origin
   * doesn't match current origin AND the entry is fresh (< 5 min),
   * we redirect there so the user lands back where they started.
   *
   * The session cookie is .basudrus.com-scoped, so it travels.
   *
   * Once the bounce completes (or doesn't apply), we clear the flag.
   */
  useEffect(() => {
    if (!user) return;
    const entry = readOauthOrigin();
    // Clear the marker either way — single-use, so a stale value
    // doesn't keep firing on every render.
    clearOauthOrigin();
    if (!entry) return;
    // Already on the right origin? Nothing to do.
    if (entry.origin === window.location.origin) return;
    // Bounce. Use window.location.replace so the .basudrus.com-scoped
    // auth cookie comes along with us to the new origin and the
    // supabase client there reads it on init.
    try { window.location.replace(entry.origin + "/"); } catch { /* noop */ }
  }, [user]);

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
  const [googleBusy, setGoogleBusy] = useState(false);

  /**
   * Google OAuth. Mirrors the pattern in features/onboarding/OnboardingScreen
   * — supabase.auth.signInWithOAuth performs a full-page redirect to
   * Google, then back to redirectTo with the code in the URL hash.
   * The SIGNED_IN auth event fires automatically on return and our
   * SignInGate falls through.
   *
   * CROSS-SUBDOMAIN SAFETY NET:
   * Supabase ignores the redirectTo we pass if the URL isn't in the
   * project's Redirect URL allowlist — it silently falls back to the
   * Site URL. If a user signs in from ai.basudrus.com but the Supabase
   * dashboard doesn't whitelist that origin yet, they'd land on
   * basudrus.com after Google auth. We remember the original origin
   * in localStorage and, after the SIGNED_IN event fires elsewhere,
   * bounce the user back to where they started.
   *
   * Friendly error if the provider isn't enabled in the Supabase
   * dashboard yet — we surface that explicitly so the user knows
   * to fall back to email instead of getting opaque SDK jargon.
   */
  const signInWithGoogle = async () => {
    setErr(null);
    setGoogleBusy(true);
    try {
      // Remember where we started so we can bounce back after OAuth.
      // Uses a .basudrus.com-scoped cookie so the value survives
      // cross-subdomain redirects (localStorage wouldn't — it's
      // scoped per-origin and we'd lose it when Supabase routes
      // the OAuth callback to a different subdomain).
      setOauthOrigin(window.location.origin);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      // Redirect takes over; we don't reach the line below.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed.";
      setErr(
        /provider.*disabled|not enabled|Unsupported provider/i.test(msg)
          ? "Google sign-in isn't enabled yet — please use email for now."
          : msg,
      );
      setGoogleBusy(false);
    }
  };

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
    <div className="min-h-dvh bg-bg text-ink flex flex-col p-6">
      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Quick product context for first-time visitors AND for any
            payment-processor reviewer who lands on the sign-in screen
            before approving the store. Without this, basudrus.com root
            looks like an empty form with no explanation of what the
            product is — which is exactly why Lemon Squeezy bounced the
            first application. The "About" link routes to the public
            /about page (static HTML, no auth required) where reviewers
            can see screenshots, features, FAQ, and pricing. */}
        {mode === "in" && (
          <div className="mb-6 -mt-4 text-center">
            <a
              href="/about"
              className="inline-flex items-center gap-1.5 text-xs text-ink/55 hover:text-ink underline-offset-2 hover:underline"
            >
              New here? Learn about Bas Udrus →
            </a>
          </div>
        )}
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
          {/* Google sign-in — primary CTA in sign-in / sign-up modes.
              Hidden in reset mode because OAuth doesn't help reset a
              password. The "G" mark is rendered as inline SVG so we
              don't need an external icon dependency. */}
          {mode !== "reset" && (
            <>
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={googleBusy || busy}
                className="w-full h-12 rounded-full border border-ink/15 bg-bg text-ink font-medium hover:bg-ink/5 disabled:opacity-50 transition inline-flex items-center justify-center gap-2.5"
              >
                <GoogleMark />
                {googleBusy ? "Redirecting…" : (mode === "up" ? "Sign up with Google" : "Continue with Google")}
              </button>
              <div className="flex items-center gap-3 text-[11px] text-ink/40 uppercase tracking-wider">
                <span className="flex-1 h-px bg-ink/10" />
                or with email
                <span className="flex-1 h-px bg-ink/10" />
              </div>
            </>
          )}

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

      {/* Footer with legal links — REQUIRED on the sign-in screen so
          payment-processor crawlers (Paddle, Lemon Squeezy, Stripe)
          can find Terms, Privacy, and Refund policies from the
          basudrus.com root. Without these links, automated reviewers
          flag the application as missing required policy disclosures.
          Plain anchor tags route through the Vercel rewrites in
          vercel.json which serve the static HTML pages. */}
      <footer className="pt-10 pb-2 text-center text-xs text-ink/50">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-2">
          <a href="/about" className="hover:text-ink hover:underline underline-offset-2">About</a>
          <a href="/pricing" className="hover:text-ink hover:underline underline-offset-2">Pricing</a>
          <a href="/terms" className="hover:text-ink hover:underline underline-offset-2">Terms</a>
          <a href="/privacy" className="hover:text-ink hover:underline underline-offset-2">Privacy</a>
          <a href="/refund" className="hover:text-ink hover:underline underline-offset-2">Refund</a>
          <a href="mailto:basudrusjo@gmail.com" className="hover:text-ink hover:underline underline-offset-2">Contact</a>
        </div>
        <div className="text-ink/40">© 2026 Bas Udrus · Operated from Amman, Jordan</div>
      </footer>
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

/**
 * Google "G" mark — official multi-color logo as inline SVG so we
 * don't pull in @react-oauth/google just for the icon. Source:
 * Google brand guidelines, simplified path.
 */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 01-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86a5.31 5.31 0 01-4.99-3.67H.99v2.33A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M4.01 10.75A5.41 5.41 0 013.72 9c0-.61.11-1.2.29-1.75V4.92H.99A8.997 8.997 0 000 9c0 1.45.35 2.83.96 4.04l3.05-2.29z" fill="#FBBC05"/>
      <path d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.997 8.997 0 009 0 8.997 8.997 0 00.96 4.96l3.05 2.33A5.31 5.31 0 019 3.58z" fill="#EA4335"/>
    </svg>
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
