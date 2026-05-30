/**
 * Sign-in screen — email + password, with toggle to sign-up.
 *
 * Mobile-first patterns:
 *   - autoCapitalize="none" on email (otherwise iOS capitalizes the
 *     first letter and Supabase rejects "Ahmed@..." as not matching)
 *   - keyboardType="email-address" pulls up the @ key
 *   - returnKeyType moves focus / submits with the keyboard's blue
 *     button instead of forcing the user to dismiss + tap
 *   - KeyboardAvoidingView so the form doesn't get covered when the
 *     keyboard opens (iOS only — Android handles this natively)
 */
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { tap, error as hError, success as hSuccess } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

export default function SignInScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { signInPassword, signUpPassword } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setErrorText('Email and password required.');
      hError();
      return;
    }
    setErrorText(null);
    setLoading(true);
    const result = isSignUp
      ? await signUpPassword(email.trim(), password)
      : await signInPassword(email.trim(), password);
    setLoading(false);

    if (result.error) {
      setErrorText(result.error);
      hError();
    } else {
      hSuccess();
      // Gate in _layout redirects to (tabs) on its own — no router call.
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={[styles.brand, { color: c.text }]}>Bas Udrus</Text>
          <Text style={[styles.tagline, { color: c.textMuted }]}>
            {isSignUp
              ? 'Create your account to get started.'
              : 'Welcome back. Pick up where you left off.'}
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: c.textMuted }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@uni.edu"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            style={[
              styles.input,
              { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text },
            ]}
          />

          <Text style={[styles.label, { color: c.textMuted, marginTop: space.lg }]}>
            Password
          </Text>
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={c.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            returnKeyType="go"
            onSubmitEditing={submit}
            style={[
              styles.input,
              { backgroundColor: c.bgElevated, borderColor: c.border, color: c.text },
            ]}
          />

          {errorText ? (
            <Text style={[styles.error, { color: c.danger }]}>{errorText}</Text>
          ) : null}

          <View style={{ height: space.xl }} />

          <PrimaryButton
            label={isSignUp ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={loading}
          />

          <View style={{ height: space.lg }} />

          <PrimaryButton
            label={isSignUp ? 'I already have an account' : 'Create new account'}
            onPress={() => {
              tap();
              setIsSignUp((v) => !v);
              setErrorText(null);
            }}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl },
  hero: { marginBottom: space.xxl },
  brand: {
    fontSize: font.sizes.display,
    fontWeight: font.weights.bold,
    letterSpacing: -0.8,
    marginBottom: space.sm,
  },
  tagline: {
    fontSize: font.sizes.lg,
    lineHeight: 24,
  },
  form: { gap: 0 },
  label: {
    fontSize: font.sizes.sm,
    fontWeight: font.weights.medium,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  input: {
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    fontSize: font.sizes.lg,
  },
  error: {
    fontSize: font.sizes.md,
    marginTop: space.md,
  },
});
