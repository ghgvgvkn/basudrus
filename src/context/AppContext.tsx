/**
 * AppContext — the redesign's root state.
 *
 * Responsibilities:
 *   - screen: which feature screen is active (string, not a route)
 *   - profile: the current user's Profile (or null if signed out)
 *   - isOnline: navigator.onLine mirrored
 *   - aiPrefill: the query the palette hands to the AI screen
 *   - darkMode: next-themes handles the class, this is a mirrored
 *                 boolean for code paths that need to branch on theme
 *                 without reading the DOM (e.g. Canvas colour choices)
 *
 * This is intentionally NOT the same AppContext as the legacy app.
 * The live repo's `AppContext` wires into its own routing hierarchy
 * and session machine. The redesign keeps the surface minimal; the
 * port into the live repo will either bridge this context to the
 * old one or replace it wholesale — that's a slice-4 decision.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Profile, ScreenId, Subscription, PersonalityAnswers } from "@/shared/types";
import { PAYMENTS_LIVE } from "@/lib/featureFlags";

interface AppValue {
  screen: ScreenId;
  setScreen: (s: ScreenId | string) => void;

  profile: Profile | null;
  setProfile: (p: Profile | null) => void;

  isOnline: boolean;

  /** When the command palette hands a query to the AI screen. */
  aiPrefill: string;
  setAIPrefill: (s: string) => void;

  /** Dark mode (mirrored from `<html class="dark">`). */
  darkMode: boolean;
  toggleDarkMode: () => void;

  /** Opens the "Post for help" composer. The composer itself lives
   *  inside HomeScreen; this is just a ping the screen listens for. */
  openPostComposer: () => void;
  postComposerOpen: boolean;
  closePostComposer: () => void;

  /** Deep-link into a profile drawer from the command palette. */
  profileDrawerId: string | null;
  openProfileDrawer: (id: string) => void;
  closeProfileDrawer: () => void;

  /** Deep-link into a room detail sheet from anywhere. */
  roomDrawerId: string | null;
  openRoomDrawer: (id: string) => void;
  closeRoomDrawer: () => void;

  /** Subscription + AI quota. */
  subscription: Subscription;
  consumeAIMessage: () => boolean; // true on success, false if capped
  upgradeToPro: () => void;
  cancelPro: () => void;

  /** Onboarding. */
  onboardingComplete: boolean;
  personality: PersonalityAnswers | null;
  completeOnboarding: (answers: PersonalityAnswers | null) => void;

  /** Auth. Demo mode: "none" fresh, "guest" if skipped, otherwise
   *  signed in via one of the providers. Live port: drive from
   *  supabase.auth — the surface stays the same. */
  authMethod: "none" | "guest" | "email" | "google" | "apple";
  signIn: (method: "guest" | "email" | "google" | "apple", email?: string, name?: string) => void;
  signOut: () => void;
}

const AppContext = createContext<AppValue | null>(null);

/** Seed profile used in demo mode when Supabase isn't wired. Pulled
 *  out so tests / Storybook can import it directly. */
export const DEMO_PROFILE: Profile = {
  id: "demo-user",
  name: "Layla Rahman",
  uni: "King Fahd University",
  major: "Computer Engineering",
  year: 3,
  bio: "Third-year CE. Loves a whiteboard and a long walk.",
  interests: ["algorithms", "arabic lit", "rock climbing"],
  avatar_color: "#5B4BF5",
  points: 1240,
  streak: 12,
  email: "layla@example.com",
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<ScreenId>("home");
  const [profile, setProfile] = useState<Profile | null>(DEMO_PROFILE);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [aiPrefill, setAIPrefill] = useState("");
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  const [postComposerOpen, setPostComposerOpen] = useState(false);
  const [profileDrawerId, setProfileDrawerId] = useState<string | null>(null);
  const [roomDrawerId, setRoomDrawerId] = useState<string | null>(null);

  // ── Subscription ─────────────────────────────────────────────
  // Free tier: 30 AI messages/day. Pro: unlimited. Persisted to
  // localStorage so the demo bundle keeps quota across reloads
  // without a backend. The live port should read from Supabase +
  // Paddle webhooks and ignore this localStorage fallback.
  //
  // Free tier daily cap is deliberately tight (10) so users feel the
  // Pro value within 2 sessions. The production number can be
  // tuned per tier via a `subscription_tiers` row; keep this in sync.
  const [subscription, setSubscription] = useState<Subscription>(() => {
    try {
      const raw = localStorage.getItem("bu:sub");
      if (raw) {
        const parsed = JSON.parse(raw) as Subscription;
        // Infinity becomes null through JSON — normalize Pro tier.
        if (parsed.tier === "pro") {
          parsed.aiQuota = Infinity;
          parsed.aiCap = Infinity;
        }
        // Roll the daily quota if the reset time has passed.
        // Also refresh cap in case we tuned it since the user's
        // last session (10 today vs 30 yesterday).
        if (parsed.tier === "free" && Date.parse(parsed.resetsAt) < Date.now()) {
          return { ...parsed, aiQuota: 10, aiCap: 10, resetsAt: tomorrowMidnightISO() };
        }
        // Migrate pre-existing 30-cap state to the new 10-cap.
        if (parsed.tier === "free" && parsed.aiCap !== 10) {
          return { ...parsed, aiCap: 10, aiQuota: Math.min(parsed.aiQuota, 10) };
        }
        return parsed;
      }
    } catch { /* noop */ }
    return { tier: "free", aiQuota: 10, aiCap: 10, resetsAt: tomorrowMidnightISO() };
  });

  const persistSub = useCallback((s: Subscription) => {
    try { localStorage.setItem("bu:sub", JSON.stringify(s)); } catch { /* noop */ }
    setSubscription(s);
  }, []);

  const consumeAIMessage = useCallback((): boolean => {
    if (subscription.tier === "pro") return true;
    if (subscription.aiQuota <= 0) return false;
    persistSub({ ...subscription, aiQuota: subscription.aiQuota - 1 });
    return true;
  }, [subscription, persistSub]);

  const upgradeToPro = useCallback(() => {
    // ── Kill-switch ──
    // Until a real payment processor (Paddle / Lemon Squeezy / Stripe)
    // is wired up, this function is a no-op so no code path can flip
    // a user to Pro for free. The SubscriptionScreen also disables
    // its CTA when PAYMENTS_LIVE is false; this is defence-in-depth
    // for any other surface that calls upgradeToPro directly.
    // To enable: set PAYMENTS_LIVE = true in src/lib/featureFlags.ts.
    if (!PAYMENTS_LIVE) {
      if (import.meta.env.DEV) {
        console.warn("[AppContext] upgradeToPro called but PAYMENTS_LIVE is false — ignoring.");
      }
      return;
    }
    persistSub({
      tier: "pro",
      aiQuota: Infinity,
      aiCap: Infinity,
      resetsAt: tomorrowMidnightISO(),
      renewsAt: new Date(Date.now() + 30 * 86400e3).toISOString(),
      paymentLast4: "4242",
    });
  }, [persistSub]);

  const cancelPro = useCallback(() => {
    persistSub({ tier: "free", aiQuota: 10, aiCap: 10, resetsAt: tomorrowMidnightISO() });
  }, [persistSub]);

  // ── Onboarding ───────────────────────────────────────────────
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    try { return localStorage.getItem("bu:onboarded") === "1"; } catch { return true; }
  });

  // ── Auth ───────────────────────────────────────────────────
  const [authMethod, setAuthMethod] = useState<AppValue["authMethod"]>(() => {
    try { return (localStorage.getItem("bu:auth") as AppValue["authMethod"]) || "none"; }
    catch { return "none"; }
  });
  const signIn = useCallback<AppValue["signIn"]>((method, email, name) => {
    try { localStorage.setItem("bu:auth", method); } catch { /* noop */ }
    setAuthMethod(method);
    setProfile((p) => p ? {
      ...p,
      email: email ?? p.email,
      name:  name  ?? p.name,
    } : p);
  }, []);
  const signOut = useCallback(() => {
    try { localStorage.removeItem("bu:auth"); } catch { /* noop */ }
    setAuthMethod("none");
  }, []);
  const [personality, setPersonality] = useState<PersonalityAnswers | null>(() => {
    try {
      const raw = localStorage.getItem("bu:personality");
      return raw ? (JSON.parse(raw) as PersonalityAnswers) : null;
    } catch { return null; }
  });
  const completeOnboarding = useCallback((answers: PersonalityAnswers | null) => {
    try {
      localStorage.setItem("bu:onboarded", "1");
      if (answers) localStorage.setItem("bu:personality", JSON.stringify(answers));
    } catch { /* noop */ }
    setPersonality(answers);
    setOnboardingComplete(true);
  }, []);

  // ── Online/offline mirror ────────────────────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ── Dark-mode toggle ─────────────────────────────────────────
  // We don't depend on next-themes for the boolean — it's fine to
  // just twiddle the class ourselves. next-themes-style persistence
  // can be layered on top later without changing this API.
  const toggleDarkMode = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("bu:theme", next ? "dark" : "light");
    } catch {
      /* non-fatal */
    }
    setDarkMode(next);
  }, []);

  // Hydrate dark mode from storage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("bu:theme");
      if (stored === "dark") {
        document.documentElement.classList.add("dark");
        setDarkMode(true);
      } else if (stored === "light") {
        document.documentElement.classList.remove("dark");
        setDarkMode(false);
      }
    } catch {
      /* no-op */
    }
  }, []);

  // ── Screen setter (accepts stringified ids too) ──────────────
  const setScreen = useCallback((s: ScreenId | string) => {
    setScreenState(s as ScreenId);
  }, []);

  // ── Command-palette profile-open bus ─────────────────────────
  useEffect(() => {
    const onOpen = (e: Event) => {
      const ev = e as CustomEvent<string>;
      if (typeof ev.detail === "string") setProfileDrawerId(ev.detail);
    };
    window.addEventListener("bas:open-profile", onOpen as EventListener);
    return () => window.removeEventListener("bas:open-profile", onOpen as EventListener);
  }, []);

  const value = useMemo<AppValue>(
    () => ({
      screen,
      setScreen,
      profile,
      setProfile,
      isOnline,
      aiPrefill,
      setAIPrefill,
      darkMode,
      toggleDarkMode,
      openPostComposer: () => setPostComposerOpen(true),
      postComposerOpen,
      closePostComposer: () => setPostComposerOpen(false),
      profileDrawerId,
      openProfileDrawer: (id) => setProfileDrawerId(id),
      closeProfileDrawer: () => setProfileDrawerId(null),
      roomDrawerId,
      openRoomDrawer: (id) => setRoomDrawerId(id),
      closeRoomDrawer: () => setRoomDrawerId(null),
      subscription, consumeAIMessage, upgradeToPro, cancelPro,
      onboardingComplete, personality, completeOnboarding,
      authMethod, signIn, signOut,
    }),
    [
      screen, setScreen, profile, isOnline, aiPrefill, darkMode,
      toggleDarkMode, postComposerOpen, profileDrawerId, roomDrawerId,
      subscription, consumeAIMessage, upgradeToPro, cancelPro,
      onboardingComplete, personality, completeOnboarding,
      authMethod, signIn, signOut,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

function tomorrowMidnightISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
