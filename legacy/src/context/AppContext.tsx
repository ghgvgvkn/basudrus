import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/supabase";
import { LIGHT, DARK, type Theme } from "@/lib/constants";
import { useNetworkStatus } from "@/shared/useNetworkStatus";
import { setCurrentScreen } from "@/services/analytics";

const DEFAULT_PROFILE: Partial<Profile> = {
  name: "", uni: "", major: "", course: "", year: "", meet_type: "flexible",
  bio: "", avatar_emoji: "🫶", avatar_color: "#6C8EF5", photo_mode: "initials",
  photo_url: null, streak: 0, xp: 0, badges: [], sessions: 0, rating: 0, subjects: [], online: true,
};

interface AppContextValue {
  user: { id: string; email: string } | null;
  setUser: React.Dispatch<React.SetStateAction<{ id: string; email: string } | null>>;
  profile: Partial<Profile>;
  setProfile: React.Dispatch<React.SetStateAction<Partial<Profile>>>;
  darkMode: boolean;
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  T: Theme;
  screen: string;
  setScreen: (s: string) => void;
  showNotif: (msg: string, type?: string) => void;
  notif: { msg: string; type: string } | null;
  isOnline: boolean;
  isAdmin: boolean;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("bas-udrus-dark") === "true"; } catch { return false; }
  });
  const T = darkMode ? DARK : LIGHT;
  useEffect(() => { try { localStorage.setItem("bas-udrus-dark", String(darkMode)); } catch { /* storage unavailable */ } }, [darkMode]);

  const [screen, _setScreen] = useState<string>("landing");
  const setScreen = useCallback((s: string) => { setCurrentScreen(s); _setScreen(s); }, []);

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Partial<Profile>>(DEFAULT_PROFILE);

  const [notif, setNotif] = useState<{ msg: string; type: string } | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotif = useCallback((msg: string, type = "ok") => {
    setNotif({ msg, type });
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(() => setNotif(null), 2800);
  }, []);

  const [loading, setLoading] = useState(true);
  const isOnline = useNetworkStatus();

  // isAdmin is authoritative via the server-side is_admin() RPC. Prior code
  // compared `user.email === ADMIN_EMAIL` which was trivially bypassable by
  // anyone who could inspect the bundle. The RPC reads admin_users (locked
  // behind a deny-all RLS) via SECURITY DEFINER, so the result is trustworthy
  // for gating UI — though any real authorization still happens in DB RLS.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("is_admin");
        if (cancelled) return;
        setIsAdmin(!error && data === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const value = useMemo<AppContextValue>(() => ({
    user, setUser, profile, setProfile,
    darkMode, setDarkMode, T,
    screen, setScreen,
    showNotif, notif,
    isOnline, isAdmin,
    loading, setLoading,
  }), [user, profile, darkMode, T, screen, setScreen, showNotif, notif, isOnline, isAdmin, loading]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
