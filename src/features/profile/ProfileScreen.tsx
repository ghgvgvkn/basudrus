/**
 * ProfileScreen — user's own profile.
 *
 * Reads the real `profiles` row via useRealProfile when signed in,
 * falls back to the AppContext mock for guest mode. Inline edit
 * for name, bio, major (text), uni (text), year (1-7), course.
 *
 * Photo upload + subjects-as-chips are deferred to the next slice
 * (needs Storage RLS + multi-select UI).
 */
import { useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useApp } from "@/context/AppContext";
import { Avatar } from "@/shared/Avatar";
import { Flame, Trophy, Pencil, Sparkles, ChevronRight, Infinity as InfinityIcon, ShieldCheck, LogIn, Save, X, LogOut, Camera, ClipboardList } from "lucide-react";
import { uploadAvatar } from "./uploadAvatar";
import { useRealProfile } from "./useRealProfile";
import { CoursesPicker } from "./CoursesPicker";
import { useSupabaseSession, signOutEverywhere } from "@/features/auth/useSupabaseSession";
import { PersonalityQuizScreen } from "@/features/match/PersonalityQuizScreen";
import { useUniversities, useMajors } from "@/features/onboarding/useOnboardingCatalog";

// Year selector — same scale as Onboarding (1-7 covers undergrad,
// 5-year pharmacy/eng, 6-7 year medicine/dentistry).
const YEARS: number[] = [1, 2, 3, 4, 5, 6, 7];

export function ProfileScreen() {
  const { profile: ctxProfile, setScreen, subscription, authMethod } = useApp();
  const { user } = useSupabaseSession();
  const real = useRealProfile();
  const [editing, setEditing] = useState(false);
  // Personality quiz overlay — opens when user clicks "Retake quiz".
  // PersonalityQuizScreen handles the load + upsert; we just toggle.
  const [quizOpen, setQuizOpen] = useState(false);
  const [draft, setDraft] = useState<{
    name: string; bio: string; uni: string; major: string; year: string;
    course: string; subjects: string[];
  }>({
    name: "", bio: "", uni: "", major: "", year: "", course: "", subjects: [],
  });
  const [saving, setSaving] = useState(false);
  // "✓ Saved" badge shown briefly next to the courses field after
  // an auto-save lands. Lets the user know their pick persisted
  // without needing to click the main Save button.
  const [coursesJustSaved, setCoursesJustSaved] = useState(false);
  // Sign-out busy state — disables the button + shows "Signing out…"
  // so the user knows the click registered while we wait for the
  // server round-trip + page reload.
  const [signingOut, setSigningOut] = useState(false);
  // The Supabase universities table uses uuid as the FK key for
  // uni_majors. The profile only stores the display name (`uni`),
  // so we keep `uniId` as edit-time state, derived from the picked
  // dropdown value, and use it to filter majors. Stored on save as
  // the `uni` name string only.
  const [uniId, setUniId] = useState<string>("");

  // Live catalog from Supabase — same hooks the OnboardingScreen
  // uses, so picking lists exactly match the data the matching
  // engine sees.
  const { data: unis, loading: unisLoading } = useUniversities();
  const { data: majors, loading: majorsLoading } = useMajors(uniId || null);

  // When the real profile lands (after sign-in), seed the edit
  // form so the user starts with their current values.
  useEffect(() => {
    if (real.profile) {
      setDraft({
        name:     real.profile.name     ?? "",
        bio:      real.profile.bio      ?? "",
        uni:      real.profile.uni      ?? "",
        major:    real.profile.major    ?? "",
        year:     real.profile.year     ?? "",
        course:   real.profile.course   ?? "",
        // Defensive dedup at read-time — old polluted rows show
        // up here as ["Anatomy I","Anatomy I","Anatomy I",...].
        // Picker shows clean list; save() persists the dedup.
        subjects: dedupSubjects(real.profile.subjects),
      });
    }
  }, [real.profile]);

  // Once the unis list arrives, resolve the seeded uni-name back to
  // its uuid so the major dropdown can populate. Runs whenever
  // either the real profile (= initial uni name) or the unis list
  // changes — e.g. coming back online.
  useEffect(() => {
    if (!unis || unis.length === 0) return;
    if (!draft.uni) { setUniId(""); return; }
    const match = unis.find((u) => u.name.trim().toLowerCase() === draft.uni.trim().toLowerCase());
    if (match && match.id !== uniId) setUniId(match.id);
  }, [unis, draft.uni, uniId]);

  // Source of truth: the real DB row when authed, otherwise the
  // demo profile from AppContext. Both use the same shape because
  // we ported the prod Profile type into the redesign.
  const profile = real.profile ?? (ctxProfile as unknown as {
    name?: string; bio?: string; uni?: string; major?: string;
    year?: string | number | null; course?: string;
    streak?: number; xp?: number;
    avatar_color?: string; photo_mode?: string; photo_url?: string | null;
    subjects?: string[];
  });
  if (!profile) return null;
  const isGuest = !user || authMethod === "guest" || authMethod === "none";

  const save = async () => {
    setSaving(true);
    try {
      // Deduplicate subjects (case-insensitive) so old polluted
      // rows that accumulated "Anatomy I" five times get cleaned
      // up on the next save. Preserves first-occurrence casing.
      const seen = new Set<string>();
      const cleanSubjects: string[] = [];
      for (const raw of draft.subjects) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleanSubjects.push(trimmed);
      }

      await real.update({
        name:     draft.name.trim(),
        bio:      draft.bio.trim(),
        uni:      draft.uni.trim(),
        major:    draft.major.trim(),
        year:     draft.year.trim(),
        // `course` (singular) is no longer in the form — the
        // multi-add picker below covers it. We deliberately omit
        // it from the update so existing values aren't blanked.
        subjects: cleanSubjects,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (real.profile) {
      setDraft({
        name:     real.profile.name     ?? "",
        bio:      real.profile.bio      ?? "",
        uni:      real.profile.uni      ?? "",
        major:    real.profile.major    ?? "",
        year:     real.profile.year     ?? "",
        course:   real.profile.course   ?? "",
        // Defensive dedup at read-time — old polluted rows show
        // up here as ["Anatomy I","Anatomy I","Anatomy I",...].
        // Picker shows clean list; save() persists the dedup.
        subjects: dedupSubjects(real.profile.subjects),
      });
    }
    setEditing(false);
  };

  return (
    <>
      <TopBar title="Profile" onOpenPalette={() => (window as typeof window & { __basOpenPalette?: () => void }).__basOpenPalette?.()} />
      <div className="max-w-[900px] mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
        <section className="bu-card p-6 lg:p-8">
          {editing ? (
            <div className="space-y-4">
              <div className="flex items-start gap-5 mb-2">
                <PhotoUploadButton
                  profile={profile as { name?: string; avatar_color?: string; photo_mode?: string; photo_url?: string | null }}
                  onUpdated={(url) => real.update({ photo_url: url, photo_mode: "photo" })}
                />
                <div className="flex-1 min-w-0">
                  <Field label="Name">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
                      maxLength={80}
                      placeholder="Your name"
                      className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 text-ink-1 focus:border-accent outline-none"
                    />
                  </Field>
                </div>
              </div>
              <Field label="Bio">
                <textarea
                  value={draft.bio}
                  onChange={(e) => setDraft(d => ({ ...d, bio: e.target.value }))}
                  rows={3}
                  maxLength={280}
                  placeholder="A line or two about how you study."
                  className="w-full px-3 py-2.5 rounded-lg border border-line bg-surface-1 text-ink-1 focus:border-accent outline-none resize-none"
                />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="University">
                  {/* Dropdown sourced from Supabase `universities` —
                      same source the matching engine uses. Picking a
                      uni resets the major (different unis have
                      different major lists) so we can't keep stale
                      data. */}
                  <select
                    value={uniId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const picked = unis.find(u => u.id === id);
                      setUniId(id);
                      setDraft(d => ({
                        ...d,
                        uni: picked?.name ?? "",
                        // Reset major because uni-major catalog is
                        // scoped per university.
                        major: id ? "" : d.major,
                      }));
                    }}
                    className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 text-ink-1 focus:border-accent outline-none"
                  >
                    <option value="">{unisLoading ? "Loading…" : "Pick a university"}</option>
                    {unis.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Major">
                  {/* Dropdown sourced from `uni_majors` filtered by
                      the picked university id. Disabled until a uni
                      is chosen so the user can't pick a major that
                      doesn't belong to their school. */}
                  <select
                    value={draft.major}
                    onChange={(e) => setDraft(d => ({ ...d, major: e.target.value }))}
                    disabled={!uniId}
                    className="w-full h-11 px-3 rounded-lg border border-line bg-surface-1 text-ink-1 focus:border-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!uniId ? "Pick a university first" : majorsLoading ? "Loading…" : "Pick a major"}
                    </option>
                    {majors.map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Year">
                  {/* Chip selector — matches Onboarding so the same
                      values flow into match scoring. */}
                  <div role="radiogroup" aria-label="Year of study" className="flex flex-wrap gap-2">
                    {YEARS.map((y) => {
                      const selected = String(draft.year) === String(y);
                      return (
                        <button
                          key={y}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setDraft(d => ({ ...d, year: String(y) }))}
                          className={
                            "h-10 px-4 rounded-full border text-sm transition " +
                            (selected
                              ? "bg-ink-1 text-surface-0 border-ink-1"
                              : "bg-surface-1 text-ink-1 border-line hover:border-ink-2")
                          }
                        >
                          Year {y}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>

              {/* Courses — single multi-add picker. The legacy
                  free-text "Current course" field was removed because
                  it was redundant with this picker AND let users type
                  any string, breaking matching when "CS 301" matched
                  no canonical course name. Now there's one source of
                  truth, populated from the `uni_courses` catalog.

                  Auto-save: every add/remove writes to Supabase
                  immediately so users don't need to click the main
                  Save button just to commit a course change. The
                  "✓ Saved" badge gives feedback for ~1.5s after each
                  successful write. */}
              <Field label={
                <span className="inline-flex items-center gap-2">
                  Your courses (add as many as you want)
                  {coursesJustSaved && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0E8A6B] normal-case tracking-normal">
                      <Save className="h-3 w-3" /> Saved
                    </span>
                  )}
                </span>
              }>
                <CoursesPicker
                  selected={draft.subjects}
                  onChange={(next) => {
                    // 1. Update the draft so the chip list re-renders
                    //    instantly with the new picks.
                    setDraft(d => ({ ...d, subjects: next }));
                    // 2. If the user is signed in (real profile path),
                    //    persist the deduped list to Supabase right
                    //    now. Guests fall back to draft-only state
                    //    because they don't have a profile row yet.
                    if (real.profile) {
                      const cleaned = dedupSubjects(next);
                      void real.update({ subjects: cleaned })
                        .then((row) => {
                          if (row) {
                            setCoursesJustSaved(true);
                            // Auto-clear the saved badge so it doesn't
                            // linger forever — feels more like a toast.
                            setTimeout(() => setCoursesJustSaved(false), 1500);
                          }
                        });
                    }
                  }}
                  placeholder="Search courses (CS 301, Calculus, Biology…) and tap to add"
                />
              </Field>
              {real.error && (
                <p className="text-xs text-[#C23F6C]">{real.error}</p>
              )}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={cancel}
                  className="h-11 px-5 rounded-full text-ink-2 hover:bg-surface-2 inline-flex items-center gap-2"
                ><X className="h-4 w-4" /> Cancel</button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 h-11 rounded-full bg-accent text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2"
                ><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-5">
              <Avatar profile={profile as Parameters<typeof Avatar>[0]["profile"]} size={96} />
              <div className="flex-1 min-w-0">
                <h1 className="serif text-3xl text-ink-1" style={{ fontStyle: "italic" }}>{profile.name}</h1>
                <div className="text-ink-3 text-sm mt-1">
                  {[profile.major, profile.year ? `Year ${profile.year}` : null, profile.uni].filter(Boolean).join(" · ") || "Tell us about yourself"}
                </div>
                {profile.bio && <p className="text-ink-2 text-sm mt-3 leading-relaxed">{profile.bio}</p>}
                <div className="flex flex-wrap gap-2 mt-4">
                  {(profile.subjects ?? []).map((s: string) => (
                    <span key={s} className="px-3 h-7 inline-flex items-center rounded-full bg-surface-2 border border-line text-xs text-ink-2">{s}</span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setEditing(true)}
                aria-label="Edit profile"
                className="h-10 w-10 rounded-full border border-line grid place-items-center text-ink-2 hover:bg-surface-2"
              ><Pencil className="h-4 w-4" /></button>
            </div>
          )}
        </section>

        {isGuest && (
          <button
            onClick={() => setScreen("onboarding")}
            className="w-full text-start rounded-[var(--radius-lg)] border-2 border-dashed border-ink-1/20 bg-surface-0 p-5 hover:border-ink-1/50 hover:bg-surface-2 transition group"
            aria-label="Sign in to save your progress"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-accent-soft text-accent grid place-items-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink-1 flex items-center gap-2">
                  You're browsing as a guest
                  <span className="inline-flex h-5 px-1.5 rounded-full bg-ink-1/8 text-ink-2 text-[10px] uppercase tracking-wider">Guest</span>
                </div>
                <p className="text-ink-3 text-sm mt-0.5">
                  Sign in to save your streak, matches and Pro plan across devices.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ink-1 text-surface-0 text-xs font-medium shrink-0 group-hover:bg-[color-mix(in_oklab,var(--color-ink-1)_92%,transparent)] transition">
                <LogIn className="h-3.5 w-3.5" /> Sign in
              </span>
            </div>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bu-card p-5">
            <div className="flex items-center gap-2 text-ink-3 text-xs uppercase tracking-wider mb-2"><Flame className="h-4 w-4" /> Streak</div>
            <div className="serif text-4xl text-ink-1" style={{ fontStyle: "italic" }}>{profile.streak ?? 0}</div>
          </div>
          <div className="bu-card p-5">
            <div className="flex items-center gap-2 text-ink-3 text-xs uppercase tracking-wider mb-2"><Trophy className="h-4 w-4" /> XP</div>
            {/* Real profile uses `xp`; demo profile used `points` —
                fall back to either. */}
            <div className="serif text-4xl text-ink-1" style={{ fontStyle: "italic" }}>
              {(profile as { xp?: number; points?: number }).xp
                ?? (profile as { xp?: number; points?: number }).points
                ?? 0}
            </div>
          </div>
        </div>

        <section className="bu-card p-6">
          <h2 className="serif text-lg text-ink-1 mb-3" style={{ fontStyle: "italic" }}>Study partners</h2>
          {/* TODO: wire to profile.partners via Supabase in slice 3 */}
          <p className="text-ink-3 text-sm">No partners yet. Find some in Discover.</p>
        </section>

        {/* Personality quiz — retake to update match scores. Disabled
            for guests (no auth user → can't write to match_quiz). */}
        <button
          onClick={() => { if (user) setQuizOpen(true); else setScreen("settings"); }}
          disabled={!user}
          className="w-full text-start bu-card p-5 hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-accent-soft text-accent-ink grid place-items-center shrink-0">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-1">Personality quiz</div>
              <p className="text-ink-3 text-xs mt-0.5">
                {user
                  ? "11 questions that drive your match %. Update anytime."
                  : "Sign in to take the personality quiz."}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-ink-3 shrink-0" />
          </div>
        </button>

        {/* Subscription card — appearance changes with tier */}
        {subscription.tier === "free" ? (
          <button
            onClick={() => setScreen("subscription")}
            className="w-full text-start rounded-[var(--radius-lg)] bg-ink-1 text-surface-0 p-6 hover:bg-[color-mix(in_oklab,var(--color-ink-1)_92%,transparent)] transition group"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-white/10 grid place-items-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="serif text-2xl" style={{ fontStyle: "italic" }}>Upgrade to Pro</div>
                <p className="text-white/70 text-sm mt-1">
                  Unlimited AI, voice messages, file uploads, priority matching. JD 3.99/mo.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 opacity-60 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        ) : (
          <button
            onClick={() => setScreen("subscription")}
            className="w-full text-start bu-card p-6 hover:bg-surface-2 transition"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent-soft text-accent grid place-items-center shrink-0">
                <InfinityIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink-1">Bas Udrus Pro · active</div>
                <p className="text-ink-3 text-sm">Manage billing, payment, renewal</p>
              </div>
              <ChevronRight className="h-5 w-5 text-ink-3" />
            </div>
          </button>
        )}

        {!isGuest && (
          <button
            onClick={() => {
              // Light confirmation — no modal needed; a quick
              // window.confirm prevents accidental clicks on mobile
              // where the row is right above the bottom nav.
              const ok = typeof window !== "undefined"
                ? window.confirm("Sign out of Bas Udrus? You'll need to sign in again to come back.")
                : true;
              if (!ok) return;
              setSigningOut(true);
              // signOutEverywhere ends with window.location.href = "/"
              // so we never come back to this render — but if the
              // promise rejects somehow, we want the busy state to
              // unstick. .finally() handles that edge case.
              signOutEverywhere().finally(() => setSigningOut(false));
            }}
            disabled={signingOut}
            className="w-full h-12 rounded-full text-ink-3 hover:bg-surface-2 inline-flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
      </div>

      {/* Personality quiz overlay — owns its own state + Supabase
          upsert; closes on save or dismiss. */}
      {quizOpen && (
        <PersonalityQuizScreen
          mode="retake"
          onClose={() => setQuizOpen(false)}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-3 mb-1.5 font-medium uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

/** Dedupe a courses array case-insensitively, dropping empties.
 *  Preserves first-occurrence casing. Used at read-time AND in the
 *  save handler so old polluted rows ("Anatomy I" × 5) heal on
 *  the next persist. */
function dedupSubjects(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

interface ProfileShape {
  name?: string;
  avatar_color?: string;
  photo_mode?: string;
  photo_url?: string | null;
}

function PhotoUploadButton({
  profile, onUpdated,
}: {
  profile: ProfileShape;
  onUpdated: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasPhoto = profile.photo_mode === "photo" && !!profile.photo_url;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    const result = await uploadAvatar(f);
    setBusy(false);
    if (!result.ok || !result.url) { setErr(result.error ?? "Upload failed"); return; }
    onUpdated(result.url);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="relative h-24 w-24 rounded-full overflow-hidden grid place-items-center text-2xl font-semibold text-white group ring-2 ring-line hover:ring-accent transition disabled:opacity-50"
        style={{ background: hasPhoto ? "transparent" : (profile.avatar_color || "#5B4BF5") }}
        aria-label={hasPhoto ? "Change profile photo" : "Upload profile photo"}
      >
        {hasPhoto ? (
          <img src={profile.photo_url ?? undefined} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          (profile.name ?? "?").split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?"
        )}
        <span className="absolute inset-0 bg-ink-1/0 group-hover:bg-ink-1/40 transition-colors grid place-items-center">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity h-9 w-9 rounded-full bg-white text-ink-1 grid place-items-center">
            <Camera className="h-4 w-4" />
          </span>
        </span>
        {busy && (
          <span className="absolute inset-0 bg-ink-1/45 grid place-items-center text-xs text-white">Uploading…</span>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png, image/jpeg, image/webp, image/heic, image/heif, image/gif"
        className="hidden"
        onChange={onPick}
      />
      {err && (
        <p className="absolute top-full mt-2 start-0 text-[11px] text-[#C23F6C] whitespace-nowrap max-w-[200px]">{err}</p>
      )}
    </div>
  );
}

