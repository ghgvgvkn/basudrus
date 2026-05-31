/**
 * FAB — floating action button, bottom-right.
 *
 * Sits above the tab bar by default (we add tabBarHeight to the bottom
 * offset). The icon + optional label sit inside a pill-shaped surface
 * with a colored shadow that reads as elevation.
 *
 * Used on Discover ("post a help request") and Home ("post a help
 * request" — same destination, lower-friction entry point per the
 * product brief).
 */
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { thump } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label?: string;
  onPress: () => void;
  /** Extra bottom padding above the tab bar / safe area. */
  bottomOffset?: number;
  /** Hide label below this width — pure icon for tight layouts. */
  iconOnly?: boolean;
  accessibilityLabel?: string;
};

export function FAB({
  icon = 'add',
  label,
  onPress,
  bottomOffset = 80, // tab bar height
  iconOnly = false,
  accessibilityLabel,
}: Props) {
  const { c, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const handlePressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 10 }).start();
  const handlePress = () => { thump(); onPress(); };

  // Dark mode: keep the accent fill bright. Light mode: a near-black
  // pill reads as more deliberate ("post") than a pastel accent.
  const bg = mode === 'dark' ? c.accent : '#111111';
  const fg = mode === 'dark' ? '#000000' : '#ffffff';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + bottomOffset, right: space.xl },
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label ?? 'Post'}
          style={[
            styles.btn,
            iconOnly || !label ? styles.btnIconOnly : styles.btnPill,
            {
              backgroundColor: bg,
              shadowColor: mode === 'dark' ? c.accent : '#000',
            },
          ]}
        >
          <Ionicons name={icon} size={22} color={fg} />
          {label && !iconOnly ? (
            <Text style={[styles.label, { color: fg }]}>{label}</Text>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 50,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
  btnIconOnly: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  btnPill: {
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  label: {
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    letterSpacing: 0.1,
  },
});
