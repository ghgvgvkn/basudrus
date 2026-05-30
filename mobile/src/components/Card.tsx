/**
 * Card — pressable surface with subtle border and press feedback.
 * The bread-and-butter container for list rows, dashboard tiles,
 * profile sections.
 */
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { tap } from '@/lib/haptics';
import { radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  /** Skip haptic on press (use for non-interactive cards that
   *  still need a press-down animation for show). Default: false. */
  silent?: boolean;
};

export function Card({ children, onPress, style, silent = false }: Props) {
  const { c } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number, speed: number, bounciness: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver: true, speed, bounciness }).start();

  const handlePress = () => {
    if (!silent) tap();
    onPress?.();
  };

  const cardStyle = [
    styles.card,
    { backgroundColor: c.bgCard, borderColor: c.border },
    style,
  ];

  if (!onPress) {
    return <Animated.View style={cardStyle}>{children}</Animated.View>;
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={() => animateTo(0.985, 60, 0)}
        onPressOut={() => animateTo(1, 30, 8)}
        onPress={handlePress}
        style={cardStyle}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
});
