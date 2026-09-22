import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { palette } from '@/theme';
import { Chip3D } from '@/ui/Chip3D';
import { Text } from '@/ui/Text';

/** Gently bobbing wrapper so the floating chips feel three-dimensional. */
function Float({ children, delay = 0, amplitude = 6, style }: { children: React.ReactNode; delay?: number; amplitude?: number; style?: object }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withTiming(-amplitude, { duration: 1800 + delay / 2, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [y, delay, amplitude]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * Hero art for the welcome screen. The reference shows a 3D mascot; until the final artwork
 * asset is supplied (drop it in `assets/hero-mascot.png` and swap the centre block) this uses a
 * layered 3D house tile with floating tool chips and the "Better Homes Happier Lives" script.
 */
export function HeroIllustration() {
  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* soft radial glow */}
      <LinearGradient colors={['rgba(14,138,106,0.18)', 'rgba(14,138,106,0)']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={styles.glow} />
      <View style={styles.ring} />

      {/* centre 3D house tile */}
      <Float delay={200} amplitude={4} style={styles.center}>
        <View style={styles.houseDepth} />
        <LinearGradient colors={['#1FB187', '#0B6F55']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.house}>
          <LinearGradient colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} style={styles.houseGloss} />
          <Ionicons name="home" size={64} color="#FFFFFF" style={styles.houseIcon} />
          <View style={styles.badge}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        </LinearGradient>
      </Float>

      {/* floating tool chips */}
      <Float delay={0} style={[styles.chip, { top: 4, left: 8 }]}>
        <Chip3D icon="water" colors={['#8FE3C7', '#1C9C6E']} fg="#FFFFFF" size={46} rotate="-8deg" />
      </Float>
      <Float delay={400} style={[styles.chip, { top: 0, right: 10 }]}>
        <Chip3D icon="bulb" colors={['#FFE08A', '#E58E00']} fg="#FFFFFF" size={42} rotate="10deg" />
      </Float>
      <Float delay={800} style={[styles.chip, { top: 78, right: -4 }]}>
        <Chip3D icon="color-fill" colors={['#A5C9FF', '#2F6FED']} fg="#FFFFFF" size={44} rotate="6deg" />
      </Float>
      <Float delay={600} style={[styles.chip, { top: 96, left: -2 }]}>
        <Chip3D icon="brush" colors={['#FFB4C8', '#E0457B']} fg="#FFFFFF" size={40} rotate="-12deg" />
      </Float>
      <Float delay={1000} style={[styles.chip, { bottom: 34, right: 26 }]}>
        <Chip3D icon="hammer" colors={['#D5DBE0', '#5F6B72']} fg="#FFFFFF" size={38} rotate="14deg" />
      </Float>

      <View style={styles.script}>
        <Text style={styles.scriptLine}>Better</Text>
        <Text style={styles.scriptLine}>Homes</Text>
        <Text style={[styles.scriptLine, styles.scriptAccent]}>Happier Lives</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 190, height: 250, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 190, height: 250, borderRadius: 95 },
  ring: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1, borderColor: 'rgba(14,138,106,0.18)', top: 50 },
  center: { alignItems: 'center', justifyContent: 'center', marginTop: -10 },
  houseDepth: { position: 'absolute', width: 112, height: 112, borderRadius: 34, backgroundColor: '#0A5E48', top: 8, opacity: 0.5 },
  house: {
    width: 112,
    height: 112,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B6F55',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  houseGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 54, borderTopLeftRadius: 34, borderTopRightRadius: 34 },
  houseIcon: { textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 4 },
  badge: { position: 'absolute', right: -6, bottom: -6, width: 28, height: 28, borderRadius: 14, backgroundColor: palette.success, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  chip: { position: 'absolute' },
  script: { position: 'absolute', bottom: 0, left: 0, transform: [{ rotate: '-10deg' }] },
  scriptLine: { fontSize: 15, lineHeight: 16, fontStyle: 'italic', fontWeight: '700', color: palette.primaryDeep, letterSpacing: 0.3 },
  scriptAccent: { color: '#E0A400' },
});
