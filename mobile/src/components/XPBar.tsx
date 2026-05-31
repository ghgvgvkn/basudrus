/**
 * XPBar — animated horizontal progress bar for XP.
 * Fills from left to right on mount using spring physics.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { font, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  xp: number;
  /** XP needed for next level. Defaults to 100-xp bands. */
  xpPerLevel?: number;
};

export function XPBar({ xp, xpPerLevel = 100 }: Props) {
  const { c } = useTheme();
  const level = Math.floor(xp / xpPerLevel) + 1;
  const progress = (xp % xpPerLevel) / xpPerLevel; // 0-1
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(widthAnim, {
      toValue: progress,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start();
  }, [progress, widthAnim]);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.textMuted }]}>
          Level {level}
        </Text>
        <Text style={[styles.label, { color: c.textMuted }]}>
          {xp % xpPerLevel} / {xpPerLevel} XP
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: c.bgElevated, borderColor: c.border }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: c.accent,
              width: widthAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: font.sizes.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  track: { height: 6, borderRadius: 3, borderWidth: 1, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
