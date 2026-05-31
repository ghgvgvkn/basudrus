/**
 * Index route — fired on cold boot when the URL is `/`.
 *
 * We render an explicit <Redirect /> so expo-router moves the user
 * straight into either the tabs (if signed in) or the auth flow
 * (if not). Returning an empty <View /> the way this file used to do
 * caused a permanent white screen because nothing in the layout
 * would ever navigate AWAY from `/`.
 *
 * AuthGate in _layout.tsx still handles the case where someone hits
 * `/(auth)/sign-in` while already signed in (and vice versa). This
 * file only covers the cold-boot root entry.
 */
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { ready, session } = useAuth();

  if (!ready) {
    // Auth check is still in flight. Show a spinner so the screen is
    // never silently blank.
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' }}>
        <ActivityIndicator size="large" color="#00d4ff" />
      </View>
    );
  }

  return <Redirect href={session ? '/(tabs)' : '/(auth)/sign-in'} />;
}
