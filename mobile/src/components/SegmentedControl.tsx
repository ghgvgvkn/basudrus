/**
 * SegmentedControl — iOS-style segmented switch with a sliding indicator.
 *
 * Used by the Connect tab to flip between Messages and Mental Health.
 * Design brief was explicit: "rectangle with rounded edges, Apple
 * glass-style animation" — so we render a translucent rounded
 * container with an animated white pill that slides under the active
 * option. Tap any segment and the pill glides under it with a spring.
 *
 * Why not use @react-native-segmented-control/segmented-control:
 *   - That lib is iOS-only (Android falls back to a stack of buttons).
 *   - We want the same look on both platforms and full control over
 *     the indicator (color, shadow, transition curve).
 *
 * Width is measured at runtime via onLayout so the indicator can size
 * itself to (total_width / segment_count). Segments are equal-width.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { font, radius, space } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';

export type Segment<T extends string> = {
  /** Stable id used by the parent's state machine. */
  value: T;
  /** Text shown on the segment. Keep short. */
  label: string;
};

type Props<T extends string> = {
  segments: Segment<T>[];
  selected: T;
  onChange: (next: T) => void;
};

export function SegmentedControl<T extends string>({
  segments,
  selected,
  onChange,
}: Props<T>) {
  const { c, mode } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const segWidth = segments.length > 0 ? trackWidth / segments.length : 0;
  const selectedIndex = Math.max(0, segments.findIndex(s => s.value === selected));

  // Animated position of the sliding pill.
  const slideX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideX, {
      toValue: selectedIndex * segWidth,
      useNativeDriver: true,
      // Spring feels closer to UIKit's segmented control than a timing
      // curve — slight overshoot, gentle settle.
      tension: 180,
      friction: 22,
    }).start();
  }, [selectedIndex, segWidth, slideX]);

  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          borderColor: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
        },
      ]}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {/* Sliding active-pill — rendered behind the labels with a
          subtle shadow so it reads like a glass chip. */}
      {segWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              width: segWidth - 4,
              backgroundColor: mode === 'dark' ? '#2a2a2c' : '#ffffff',
              shadowColor: '#000',
              shadowOpacity: mode === 'dark' ? 0.4 : 0.12,
              transform: [{ translateX: slideX }],
            },
          ]}
        />
      ) : null}

      {segments.map(seg => {
        const active = seg.value === selected;
        return (
          <Pressable
            key={seg.value}
            onPress={() => {
              if (active) return;
              tap();
              onChange(seg.value);
            }}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.label,
                {
                  color: active ? c.text : c.textMuted,
                  fontWeight: active ? font.weights.bold : font.weights.medium,
                },
              ]}
              numberOfLines={1}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 36,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  pill: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    borderRadius: radius.md,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    zIndex: 1,
  },
  label: {
    fontSize: font.sizes.sm,
    letterSpacing: 0.1,
  },
});
