import { RealisticIcon } from '@/ui/RealisticIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

/** Gentle vertical bob so the tiles read as floating in front of the mascot. */
export function Float({ children, delay = 0, amplitude = 7, style }: { children: ReactNode; delay?: number; amplitude?: number; style?: ViewStyle | ViewStyle[] }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withTiming(-amplitude, { duration: 2000 + delay, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [y, delay, amplitude]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * Glossy white tile holding a service icon (tap, bulb, roller, AC) - the floating chips in
 * the welcome hero. White face + top highlight + soft coloured shadow gives the 3D read.
 */
export function FloatingTile({ iconKey, tint, size = 58, rotate = '0deg', style }: { iconKey: string; tint: string; size?: number; rotate?: string; style?: ViewStyle }) {
  const r = size * 0.3;
  return (
    <View style={[{ width: size, height: size, transform: [{ rotate }] }, style]}>
      <View style={[styles.shadow, { borderRadius: r, shadowColor: tint }]} />
      <LinearGradient colors={['#FFFFFF', '#F1F7F4']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.face, { borderRadius: r }]}>
        <LinearGradient colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']} style={[styles.gloss, { borderTopLeftRadius: r, borderTopRightRadius: r }]} />
        <RealisticIcon iconKey={iconKey} size={size * 0.6} />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  face: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },
});
