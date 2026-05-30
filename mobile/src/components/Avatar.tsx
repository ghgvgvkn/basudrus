/**
 * Avatar — renders the user's emoji+color avatar or a photo.
 * Matches the web app's Avatar logic exactly so it looks
 * consistent across platforms.
 */
import { Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';

type Props = {
  emoji?: string | null;
  color?: string | null;
  photoUrl?: string | null;
  name?: string | null;
  size?: number;
  /** Show a green online dot in the bottom-right corner. */
  online?: boolean;
};

export function Avatar({
  emoji,
  color,
  photoUrl,
  name,
  size = 44,
  online = false,
}: Props) {
  const { c } = useTheme();
  const bg = color ?? c.bgCard;
  const borderRadius = size / 2;
  const fontSize = size * 0.45;
  const dotSize = size * 0.28;

  return (
    <View style={{ width: size, height: size }}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={[styles.base, { width: size, height: size, borderRadius }]}
        />
      ) : (
        <View
          style={[
            styles.base,
            {
              width: size,
              height: size,
              borderRadius,
              backgroundColor: bg,
              borderColor: c.border,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={{ fontSize }}>
            {emoji ?? name?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      {online && (
        <View
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: '#34c759',
              borderColor: c.bg,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
  },
});
