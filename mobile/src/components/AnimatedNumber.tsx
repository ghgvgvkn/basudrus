/**
 * AnimatedNumber — counts up from 0 to `value` on mount.
 * Gives XP and streak numbers life instead of just appearing.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Text, type StyleProp, type TextStyle } from 'react-native';

type Props = {
  value: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
  suffix?: string;
};

export function AnimatedNumber({ value, style, duration = 800, suffix = '' }: Props) {
  const [display, setDisplay] = useState(0);
  const animVal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animVal.setValue(0);
    const listener = animVal.addListener(({ value: v }) => {
      setDisplay(Math.round(v));
    });
    Animated.timing(animVal, {
      toValue: value,
      duration,
      useNativeDriver: false, // value needs JS thread for listener
    }).start();
    return () => animVal.removeListener(listener);
  }, [value, animVal, duration]);

  return <Text style={style}>{display}{suffix}</Text>;
}
