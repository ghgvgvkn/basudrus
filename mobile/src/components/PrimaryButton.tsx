/**
 * PrimaryButton — pressable with haptic feedback, scale-on-press
 * animation, and theme-aware styling.
 *
 * Why custom instead of <Button>:
 *   React Native's <Button> renders the OS-native button (gray text
 *   on iOS) which doesn't fit the dark-mode JARVIS aesthetic. A
 *   Pressable with our own styling looks correct and lets us own the
 *   press animation.
 */
import { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: Props) {
  const { c } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  };

  const handlePress = () => {
    if (isDisabled) return;
    tap();
    onPress();
  };

  const bg =
    variant === 'primary' ? c.accent
    : variant === 'secondary' ? c.bgElevated
    : 'transparent';

  const textColor =
    variant === 'primary' ? '#000'
    : variant === 'ghost' ? c.accent
    : c.text;

  const border =
    variant === 'secondary' ? c.borderStrong
    : variant === 'ghost' ? 'transparent'
    : 'transparent';

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: isDisabled ? 0.5 : 1 }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        disabled={isDisabled}
        style={[styles.btn, { backgroundColor: bg, borderColor: border }]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  label: {
    fontSize: font.sizes.lg,
    fontWeight: font.weights.semibold,
    letterSpacing: 0.2,
  },
});
