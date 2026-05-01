/**
 * OnboardingScreen — first-run setup.
 *
 * Flow (5 steps, iteration 3):
 *   0. Welcome — brand, one-line promise, "Get started" CTA.
 *   1. **Auth** — Sign up / sign in (Google, Apple, email) or
 *      continue as guest. Writes AppContext.authMethod; live port
 *      swaps the mock providers for supabase.auth.signInWithOAuth /
 *      signInWithOtp. Email form is inline (no modal).
 *   2. Profile — university, major, year.
 *   3. Personality — 5 short questions that shape matching + AI tone.
 *   4. Done — lands on Home.
 *
 * Persistence: auth choice in localStorage `bu:auth`, onboarding +
 * personality in `bu:onboarded` / `bu:personality`. The live port
 * writes profiles.personality (jsonb) on the user row instead.
 *
 * Design notes:
 *   - Full-bleed, no Shell chrome. Gate in App.tsx owns this.
 *   - Single stacked canvas with a horizontal translate per step so
 *     the arc stays visible.
 *   - Auth step lets the user **skip** ("Continue as guest") — the
 *     Profile banner will then nudge them to sign in later.
 */
import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import type { PersonalityAnswers as LegacyPersonalityAnswers } from "@/shared/types";
import { Mail, ArrowRight } from "lucide-react";
import { useUniversities, useMajors } from "./useOnboardingCatalog";
import { supabase } from "@/lib/supabase";
import { CoursesPicker } from "@/features/profile/CoursesPicker";
import type { PersonalityAnswers } from "@/features/match/personalityQuestions";
import { PersonalityQuizStep } from "@/features/match/PersonalityQuizStep";
import { useSupabaseSession } from "@/features/auth/useSupabaseSession";
import { useRealProfile } from "@/features/profile/useRealProfile";

type Step = 0 | 1 | 2 | 3 | 4;

// Numeric years 1–7 covers undergrad (1–4), fifth-year pharmacy/eng
// programs, and 6–7 year medicine/dentistry tracks common in
// Jordanian universities. Value stored on the profile is the
// integer itself, not the label.
const YEARS: number[] = [1, 2, 3, 4, 5, 6, 7];

export function OnboardingScreen() {
  const { completeOnboarding, setProfile, profile, signIn } = useApp();
  const [step, setStep] = useState<Step>(0);
  // Watch for an active session — relevant for users who arrive here
  // post Google OAuth callback. After Google auth, Supabase redirects
  // back to / and we land on this screen. The user is already
  // authenticated so the Welcome + Auth steps are useless friction —
  // skip straight to the Profile-basics step (or finish onboarding
  // entirely if they have a complete profile already).
  const { user } = useSupabaseSession();
  const real = useRealProfile();

  // Auto-advance for users who arrive already authenticated (Google
  // OAuth callback, returning visitors, etc.). Two outcomes:
  //
  //   1. They have a complete profile (uni + major + year all set)
  //      → call completeOnboarding(null) and let AppGate hand off
  //        to the SignInGate / Shell. They never see this screen.
  //
  //   2. They're authed but missing profile data (typical for first
  //      Google sign-in) → jump from Welcome (step 0) or Auth
  //      (step 1) straight to Profile basics (step 2).
  //
  // We only ever ADVANCE — never roll a user backwards. So if they
  // manually navigated to step 3 (Quiz) and their session is fine,
  // we leave them where they are.
  useEffect(() => {
    if (!user) return;
    const p = real.profile;
    if (p && p.uni && p.major && p.year) {
      // Already onboarded in a previous session — finish out so the
      // gate hands off to the main app. Pass null so we don't
      // overwrite any existing personality answers.
      completeOnboarding(null);
      return;
    }
    if (step === 0 || step === 1) setStep(2);
  }, [user, real.profile, step, completeOnboarding]);

  // Auth form state. "pick" = provider chooser; "signup" / "signin"
  // = email + password forms. OTP was removed because Supabase
  // free SMTP is unreliable and the magic link redirected to prod.
  const [authMode, setAuthMode] = useState<"pick" | "signup" | "signin">("pick");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Email + password — works without any email delivery. Sign up
  // establishes a session immediately because email confirmation
  // is disabled on this Supabase project.
  const submitAuth = async (kind: "signup" | "signin") => {
    setAuthError(null);
    if (!emailInput.includes("@")) { setAuthError("Enter a valid email."); return; }
    if (passwordInput.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
    setAuthBusy(true);
    try {
      if (kind === "signup") {
        const { error } = await supabase.auth.signUp({
          email: emailInput.trim(),
          password: passwordInput,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailInput.trim(),
          password: passwordInput,
        });
        if (error) throw error;
      }
      signIn("email", emailInput);
      goTo(2);
    } catch (e) {
      setAuthError(friendlyAuthError(e));
    } finally {
      setAuthBusy(false);
    }
  };

  // tryAsGuest removed — the half-authenticated guest mode hid
  // real data behind RLS and surfaced fake stubs instead, which
  // looked broken to real users. Sign-up is free and takes 10s.

  // Apple OAuth was removed (no Apple Developer account configured),
  // but Google stays. To make Google work end-to-end you need:
  //   1. Supabase → Authentication → Providers → Google → enabled
  //   2. Add basudrus.com (and www.basudrus.com) to the Redirect
  //      URL allowlist under Supabase → Authentication → URL
  //      Configuration. Without this Google bounces back with an
  //      "invalid redirect" error.
  //   3. Set up an OAuth 2.0 Client in Google Cloud Console and
  //      paste the client_id + secret into Supabase. Authorized
  //      redirect URIs there must include the Supabase auth
  //      callback (https://<project>.supabase.co/auth/v1/callback).
  // Until those three are done the button will surface the error
  // toast — that's intentional, the user gets a clear signal
  // rather than a silent fail.
  const oauth = async (provider: "google") => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      // Full-page redirect takes over — we don't reach here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Google sign-in failed.`;
      // Friendly error: if the provider isn't enabled, the message
      // tells the user to use email instead rather than dump SDK
      // jargon at them.
      const friendly = /provider.*disabled|not enabled|Unsupported provider/i.test(msg)
        ? "Google sign-in isn't ready yet — please use email for now."
        : msg;
      setAuthError(friendly);
      setAuthBusy(false);
    }
  };

  // uniId holds the Supabase university_id (uuid) once picked. `uni`
  // holds the human-readable name so we can store it on the profile.
  const [uniId, setUniId] = useState<string>("");
  const [uni, setUni] = useState<string>("");
  const [major, setMajor] = useState<string>("");
  const [year, setYear] = useState<number | null>(null);
  // Current-semester courses, persisted to profiles.subjects[].
  // Encouraged but not required to leave step 2.
  const [courses, setCourses] = useState<string[]>([]);
  // 11-question personality quiz state. Each question's value lands
  // under its `id` key — see personalityQuestions.ts for the schema.
  // Saved to match_quiz.answers (jsonb) on completion; the same shape
  // gets read by computeScore.ts on the Discover feed side.
  const [answers, setAnswers] = useState<PersonalityAnswers>({});
  // Step 3 sub-step — which question we're on inside the quiz.
  // Sub-step >= total = "all done, ready to continue".
  const [quizIdx, setQuizIdx] = useState(0);

  // Live catalogue fetches — `universities` and `uni_majors` from
  // Supabase. Majors are lazy-loaded after a university is picked.
  const { data: unis, loading: unisLoading } = useUniversities();
  const { data: majors, loading: majorsLoading } = useMajors(uniId || null);

  const finish = async (withPersonality: boolean) => {
    // Local AppContext mirror — keeps the UI snappy while the
    // Supabase upsert is in flight.
    if (profile && (uni || major || year !== null)) {
      setProfile({
        ...profile,
        uni: uni || profile.uni,
        major: major || profile.major,
        year: year ?? profile.year,
      });
    }

    // Persist to Supabase if we have a real session. Onboarding
    // wrote nothing to the DB before this — that's why a page
    // refresh wiped your uni/major/year. Now they survive.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const patch: {
          uni?: string;
          major?: string;
          year?: string;
          subjects?: string[];
          updated_at?: string;
        } = { updated_at: new Date().toISOString() };
        if (uni) patch.uni = uni;
        if (major) patch.major = major;
        if (year !== null) patch.year = String(year);
        if (courses.length) patch.subjects = courses.map(c => c.trim()).filter(Boolean);

        // Upsert pattern — INSERT on first run (RLS profiles_insert_own
        // accepts because id = auth.uid()), UPDATE on subsequent edits.
        // Write email so the notify-email edge function (service-role
        // reader) can deliver notifications. Cross-user privacy is
        // protected by the column-level revoke on profiles.email —
        // other users cannot SELECT this column.
        const { error: upsertErr } = await supabase
          .from("profiles")
          .upsert({
            id: session.user.id,
            email: session.user.email ?? "",
            ...patch,
          }, { onConflict: "id" });
        if (upsertErr) {
          // Don't block the user — we'll retry from the Profile
          // screen. Just log to console.
          console.warn("[onboarding] profile upsert failed:", upsertErr.message);
        }

        // Persist the personality quiz answers to match_quiz.answers
        // (jsonb). Same row gets upserted on every quiz retake — the
        // unique index on user_id makes this safe. computeScore.ts
        // reads this shape directly when the Discover feed renders.
        if (withPersonality && Object.keys(answers).length > 0) {
          const { error: quizErr } = await supabase
            .from("match_quiz")
            .upsert({
              user_id: session.user.id,
              answers,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" });
          if (quizErr) {
            console.warn("[onboarding] match_quiz upsert failed:", quizErr.message);
          }
        }
      }
    } catch (e) {
      console.warn("[onboarding] profile upsert error:", e);
    }

    // AppContext mirror — keeps the legacy 5-key personality shape
    // for any code path still reading it. New code reads from
    // match_quiz directly via the Discover scoring pass.
    completeOnboarding(
      withPersonality ? (answers as unknown as LegacyPersonalityAnswers) : null,
    );
  };

  const goTo = (s: Step) => setStep(s);

  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col">
      {/* progress row */}
      <div className="flex items-center justify-center gap-2 pt-8">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={
              "h-1.5 rounded-full transition-all " +
              (i === step
                ? "w-8 bg-ink"
                : i < step
                ? "w-1.5 bg-ink"
                : "w-1.5 bg-ink/15")
            }
          />
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-out h-full"
          style={{ transform: `translateX(-${step * 20}%)`, width: "500%" }}
        >
          {/* Step 0 — Welcome */}
          <section className="w-1/5 px-6 py-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-ink text-bg flex items-center justify-center text-2xl font-serif italic mb-8">
              bu
            </div>
            <h1 className="font-serif italic text-5xl md:text-6xl leading-[1.02] max-w-xl">
              Welcome to <span className="underline decoration-2 underline-offset-4">Bas Udrus</span>.
            </h1>
            <p className="mt-6 text-ink/70 text-lg max-w-md">
              A quiet corner of the internet for Jordanian students. Study
              smarter. Meet people actually in your classes.
            </p>
            <button
              onClick={() => goTo(1)}
              className="mt-12 h-14 px-10 rounded-full bg-ink text-bg text-base font-medium hover:bg-ink/85 transition"
            >
              Get started →
            </button>
            <p className="mt-4 text-ink/50 text-sm">Takes about 60 seconds.</p>
          </section>

          {/* Step 1 — Auth */}
          <section className="w-1/5 px-6 py-12 flex flex-col items-center justify-start overflow-y-auto">
            <div className="max-w-md w-full">
              <h2 className="font-serif italic text-4xl md:text-5xl leading-tight">
                Make it yours.
              </h2>
              <p className="mt-3 text-ink/60">
                Sign in so your plans, matches and streak follow you to any
                device. Or browse first and sign in later.
              </p>

              {authMode === "pick" && (
                <div className="mt-8 space-y-2.5">
                  {/* Apple OAuth removed (no Developer account set
                      up). Google stays — see the comment on oauth()
                      above for the three-step setup needed in
                      Supabase + Google Cloud Console to make it
                      actually work. The button surfaces a friendly
                      error if it's clicked before that's done. */}
                  <AuthButton
                    onClick={() => oauth("google")}
                    label="Continue with Google"
                    icon={<GoogleGlyph />}
                  />
                  <AuthButton
                    onClick={() => { setAuthError(null); setAuthMode("signup"); }}
                    label="Sign up with email"
                    icon={<Mail size={18} />}
                  />
                  {authError && (
                    <p className="text-xs text-[#C23F6C] pt-1 text-center">{authError}</p>
                  )}
                  <p className="text-center text-sm text-ink/65 pt-1">
                    Already have an account?{" "}
                    <button onClick={() => { setAuthError(null); setAuthMode("signin"); }} className="text-ink font-medium underline-offset-2 hover:underline">
                      Sign in
                    </button>
                  </p>
                  {/* "Try as guest" REMOVED here too. Same reason
                      as in SignInGate — the guest path produced a
                      half-broken state where users saw fake stubs
                      and empty Discover. Real auth or nothing. */}
                </div>
              )}

              {(authMode === "signup" || authMode === "signin") && (
                <div className="mt-8 space-y-4">
                  <Field label="Email">
                    <input
                      type="email"
                      autoComplete="email"
                      autoFocus={!emailInput}
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitAuth(authMode); }}
                      placeholder="you@student.ju.edu.jo"
                      className="w-full h-12 px-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitAuth(authMode); }}
                      placeholder={authMode === "signin" ? "Your password" : "At least 6 characters"}
                      minLength={6}
                      className="w-full h-12 px-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
                    />
                  </Field>
                  {authError && (
                    <p className="text-xs text-[#C23F6C]">{authError}</p>
                  )}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => { setAuthMode("pick"); setAuthError(null); }}
                      className="h-12 px-5 rounded-full text-ink/60 hover:text-ink transition"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => submitAuth(authMode)}
                      disabled={!emailInput.includes("@") || passwordInput.length < 6 || authBusy}
                      className="flex-1 h-12 rounded-full bg-ink text-bg font-medium disabled:opacity-30 hover:bg-ink/85 transition inline-flex items-center justify-center gap-2"
                    >
                      {authBusy
                        ? (authMode === "signin" ? "Signing in…" : "Creating account…")
                        : <>{authMode === "signin" ? "Sign in" : "Create account"} <ArrowRight size={16} /></>}
                    </button>
                  </div>
                  <p className="text-center text-sm text-ink/65 pt-1">
                    {authMode === "signin" ? (
                      <>New here?{" "}
                        <button onClick={() => { setAuthMode("signup"); setAuthError(null); }} className="text-ink font-medium underline-offset-2 hover:underline">
                          Sign up
                        </button>
                      </>
                    ) : (
                      <>Already have an account?{" "}
                        <button onClick={() => { setAuthMode("signin"); setAuthError(null); }} className="text-ink font-medium underline-offset-2 hover:underline">
                          Sign in
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Real anchor tags so payment-processor crawlers (and
                  obviously real users) can reach the legal policies
                  from the onboarding screen. Plain text was a Paddle
                  / Lemon Squeezy verification miss — they look for
                  clickable links to Terms + Privacy + Refund. */}
              <p className="mt-8 text-[11px] text-ink/50 text-center">
                By continuing you agree to our{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink/80 underline-offset-2 hover:underline"
                >Terms</a>
                {" "}and{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink/80 underline-offset-2 hover:underline"
                >Privacy Policy</a>.
              </p>

              <div className="mt-6">
                <button
                  onClick={() => goTo(0)}
                  className="text-ink/50 hover:text-ink text-sm transition"
                >
                  ← Back
                </button>
              </div>
            </div>
          </section>

          {/* Step 2 — Profile basics */}
          <section className="w-1/5 px-6 py-12 flex flex-col items-center justify-start overflow-y-auto">
            <div className="max-w-md w-full">
              <h2 className="font-serif italic text-4xl md:text-5xl leading-tight">
                The basics.
              </h2>
              <p className="mt-3 text-ink/60">
                We use this to match you with people in your university and
                courses.
              </p>

              <div className="mt-10 space-y-6">
                <Field label="University">
                  {/* Populated from Supabase `universities` table.
                      On pick, store both the uuid (for filtering
                      majors) and the display name (for the profile
                      row). Reset the major when the uni changes. */}
                  <select
                    value={uniId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const pick = unis.find(u => u.id === id);
                      setUniId(id);
                      setUni(pick?.name ?? "");
                      setMajor("");
                    }}
                    disabled={unisLoading}
                    className="w-full h-12 px-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:opacity-50"
                  >
                    <option value="">
                      {unisLoading ? "Loading…" : "Select your university"}
                    </option>
                    {unis.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.short_name ? ` (${u.short_name})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Major">
                  {/* Populated from Supabase `uni_majors` filtered
                      by the chosen university_id. Disabled until
                      a university is picked. */}
                  <select
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    disabled={!uniId || majorsLoading}
                    className="w-full h-12 px-4 rounded-xl border border-ink/15 bg-bg text-ink focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:opacity-50"
                  >
                    <option value="">
                      {!uniId ? "Pick a university first" :
                       majorsLoading ? "Loading majors…" : "Select your major"}
                    </option>
                    {majors.map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Year">
                  <div className="flex flex-wrap gap-2">
                    {YEARS.map((y) => (
                      <button
                        key={y}
                        onClick={() => setYear(y)}
                        className={
                          "h-10 min-w-[52px] px-4 rounded-full border text-sm font-medium transition " +
                          (year === y
                            ? "bg-ink text-bg border-ink"
                            : "bg-bg text-ink border-ink/15 hover:border-ink/35")
                        }
                      >
                        Year {y}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Current courses">
                  <CoursesPicker
                    selected={courses}
                    onChange={setCourses}
                    placeholder="Search and add the courses you're taking this semester"
                  />
                </Field>
              </div>

              <div className="mt-12 flex items-center gap-3">
                <button
                  onClick={() => goTo(1)}
                  className="h-12 px-5 rounded-full text-ink/60 hover:text-ink transition"
                >
                  Back
                </button>
                <button
                  onClick={() => goTo(3)}
                  disabled={!uni || !major || year === null}
                  className="flex-1 h-12 rounded-full bg-ink text-bg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-ink/85 transition"
                >
                  Continue
                </button>
              </div>
            </div>
          </section>

          {/* Step 3 — Personality quiz (11 questions, one at a time) */}
          <section className="w-1/5 px-6 py-12 flex flex-col items-center justify-start overflow-y-auto">
            <PersonalityQuizStep
              answers={answers}
              setAnswers={setAnswers}
              quizIdx={quizIdx}
              setQuizIdx={setQuizIdx}
              onBack={() => goTo(2)}
              onSkip={() => finish(false)}
              onComplete={() => goTo(4)}
            />
          </section>

          {/* Step 4 — Done */}
          <section className="w-1/5 px-6 py-12 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-ink/5 border border-ink/10 flex items-center justify-center mb-8">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M6 16 L13 23 L26 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="font-serif italic text-5xl leading-tight">
              You're in.
            </h2>
            <p className="mt-4 text-ink/70 text-lg max-w-md">
              Discover is already matching you. Say hi to Omar whenever you're
              ready.
            </p>
            <button
              onClick={() => finish(true)}
              className="mt-12 h-14 px-10 rounded-full bg-ink text-bg text-base font-medium hover:bg-ink/85 transition"
            >
              Open Bas Udrus →
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function AuthButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-12 rounded-full border border-ink/15 bg-bg text-ink font-medium hover:border-ink/35 hover:bg-ink/5 transition inline-flex items-center justify-center gap-2.5"
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

/** Google's brand "G" SVG — color-correct (Google's brand guidelines
 *  require the four official colors). Used by the Continue-with-Google
 *  button at the top of the auth-pick step. */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

/**
 * Field — label + children wrapper for form rows.
 *
 * Uses a `<div>`, NOT a `<label>`, on purpose: when a `<label>`
 * wraps an input AND nested buttons (like the CoursesPicker
 * dropdown items), browsers redirect clicks on those buttons to
 * the input via the implicit-association rule. The user clicks
 * "Anatomy I", focus goes to the search input, the button's
 * onClick never fires. Symptom: dropdown items look clickable
 * but nothing happens.
 *
 * Switching to `<div>` removes the implicit association — each
 * inner control receives its own clicks. The label-text/control
 * relationship is mostly visual here anyway; the controls all
 * have proper aria attributes from their own components
 * (placeholder, role="radio", etc.).
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="block text-sm text-ink/60 mb-2">{label}</span>
      {children}
    </div>
  );
}


// PersonalityQuizStep moved to features/match/PersonalityQuizStep.tsx
// so it can be reused by:
//  - OnboardingScreen (initial sign-up flow, here)
//  - PersonalityQuizScreen (retake from Profile, or first-time prompt
//    for users who signed in before the quiz existed).

function friendlyAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Email or password isn't right.";
  if (lower.includes("user already registered")) return "Account exists — try signing in instead.";
  if (lower.includes("password should be at least")) return "Password must be at least 6 characters.";
  if (lower.includes("rate")) return "Too many attempts — wait a minute and try again.";
  return raw || "Something went wrong. Try again.";
}
