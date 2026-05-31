/**
 * ThemeContext — single source of truth for light/dark mode.
 *
 * Defaults to LIGHT (per product decision — most students prefer a light
 * UI for reading). User can switch to dark in Profile → Preferences →
 * Theme. Choice persists across launches via AsyncStorage so the next
 * cold start respects it.
 *
 * The hook `useTheme()` returns:
 *   - mode: 'light' | 'dark' — current effective mode
 *   - c: the palette object for the mode (drop-in replacement for
 *     the old `palette(useColorScheme() ?? 'dark')` pattern)
 *   - setMode(mode | 'system'): explicitly choose, or follow the OS
 *   - userPref: what the user picked ('light' | 'dark' | 'system'),
 *     so the Profile toggle knows which option is selected
 *
 * The legacy `useColorScheme() ?? 'dark'` pattern is migrated to
 * `useTheme()` in every screen — keeps screens unaware of where the
 * mode comes from, so future changes (e.g. scheduled dark mode after
 * 9pm) only touch this file.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palette, type ColorMode } from '@/lib/theme';

const STORAGE_KEY = 'bu:theme-pref';

export type ThemePref = 'light' | 'dark' | 'system';

type Ctx = {
  mode: ColorMode;
  c: ReturnType<typeof palette>;
  userPref: ThemePref;
  setMode: (pref: ThemePref) => void;
  /** Convenience: cycle light → dark → system → light. */
  toggle: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // OS preference — used only when userPref === 'system'.
  const os = (useColorScheme() ?? 'light') as ColorMode;

  // Optimistic-load: assume LIGHT until AsyncStorage hydrates. This
  // prevents the dark→light flash that would happen if we waited for
  // AsyncStorage before painting. Worst case: user picked dark, sees
  // ~50ms of light on cold start.
  const [userPref, setUserPrefState] = useState<ThemePref>('light');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (v === 'light' || v === 'dark' || v === 'system') {
          setUserPrefState(v);
        }
      } catch {
        /* AsyncStorage unavailable — stick with light */
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const setMode = useCallback((pref: ThemePref) => {
    setUserPrefState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {
      /* noop — preference will revert next launch */
    });
  }, []);

  const toggle = useCallback(() => {
    setUserPrefState(prev => {
      const next: ThemePref = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const mode: ColorMode = userPref === 'system' ? os : userPref;
  const c = useMemo(() => palette(mode), [mode]);

  // Memoize the context value so consumers don't re-render on
  // unrelated state changes (e.g. hydrated flipping true once).
  const value = useMemo<Ctx>(
    () => ({ mode, c, userPref, setMode, toggle }),
    [mode, c, userPref, setMode, toggle],
  );

  // Silence the unused-var warning for `hydrated` — it's a side-channel
  // for future use (e.g. delaying the splash teardown until theme is
  // resolved).
  void hydrated;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the current theme. Throws if used outside ThemeProvider — that
 * guarantees no screen accidentally bypasses the override system.
 */
export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
