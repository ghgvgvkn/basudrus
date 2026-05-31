/**
 * Root layout — wraps the whole app with:
 *   - ErrorBoundary (replaces white-screen-of-death with a visible stack)
 *   - GestureHandlerRootView (needed by gesture-handler + reanimated)
 *   - SafeAreaProvider (so screens can read safe-area insets)
 *   - AuthProvider (session state)
 *   - The Expo Router stack
 *
 * Auth gating lives here so we only need it in one place. The cold-boot
 * `/` route is handled by app/index.tsx which renders an explicit
 * <Redirect />, but this gate also catches the case where someone
 * navigates between auth/tabs while signed-in state changes.
 */
import { Component, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.hideAsync().catch(() => {});

/** Visible error boundary — replaces white-screen-of-death with the actual stack. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0a0a0a' }}
        contentContainerStyle={{ padding: 24, paddingTop: 80 }}
      >
        <Text style={styles.title}>⚠️  App crashed</Text>
        <Text style={styles.label}>Message</Text>
        <Text style={styles.body}>{this.state.error.message}</Text>
        <Text style={styles.label}>Stack</Text>
        <Text style={styles.code}>{this.state.error.stack ?? '(no stack)'}</Text>
        <Text style={[styles.label, { marginTop: 24 }]}>Reload the bundle (shake → Reload) to retry.</Text>
      </ScrollView>
    );
  }
}

function AuthGate() {
  const { ready, session } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    const inAuthGroup = segments[0] === '(auth)';
    const atRoot = (segments as unknown as string[]).length === 0;
    if (!session && !inAuthGroup) router.replace('/(auth)/sign-in');
    else if (session && (inAuthGroup || atRoot)) router.replace('/(tabs)');
  }, [ready, session, segments, router]);

  if (!ready) {
    return (
      <View style={loadingStyles.wrap}>
        <ActivityIndicator size="large" color="#00d4ff" />
        <Text style={loadingStyles.text}>Loading…</Text>
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, animation: 'default' }} />;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <ThemedChrome />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

/**
 * Inner shell that consumes the theme. Split out so RootLayout doesn't
 * need to live inside its own provider (which would be a hooks-order
 * trap if it grew). Status bar style flips with the theme so icons
 * stay readable on both palettes.
 */
function ThemedChrome() {
  const { mode, c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a', gap: 16 },
  text: { color: '#f5f5f5', fontSize: 14, opacity: 0.7 },
});

const styles = StyleSheet.create({
  title: { color: '#ff5050', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  label: { color: '#ffa500', fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  body: { color: '#fff', fontSize: 14, lineHeight: 20 },
  code: { color: '#aaa', fontSize: 11, fontFamily: 'Courier', lineHeight: 16 },
});
