import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewStyle } from 'react-native';

export interface Chip3DProps {
  icon: keyof typeof Ionicons.glyphMap;
  /** Two-stop gradient for the tile face (light -> deep). */
  colors: [string, string];
  /** Icon colour. */
  fg: string;
  size?: number;
  /** Tilt for the "3D" floating look. */
  rotate?: string;
  style?: ViewStyle;
}

/**
 * A "3D" icon tile: layered drop shadow, gradient face, glossy top highlight and a soft inner
 * rim. Used for the hero's floating tool chips and feature rows (reference design).
 */
export function Chip3D({ icon, colors, fg, size = 56, rotate = '0deg', style }: Chip3DProps) {
  const r = size * 0.3;
  return (
    <View style={[{ width: size, height: size, transform: [{ rotate }] }, style]}>
      {/* depth layer */}
      <View style={[styles.depth, { borderRadius: r, backgroundColor: colors[1] }]} />
      <LinearGradient colors={colors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.face, { borderRadius: r, shadowColor: colors[1] }]}>
        {/* glossy highlight */}
        <LinearGradient
          colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.gloss, { borderTopLeftRadius: r, borderTopRightRadius: r }]}
        />
        <View style={[styles.rim, { borderRadius: r }]} />
        <Ionicons name={icon} size={size * 0.5} color={fg} style={styles.icon} />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  depth: { position: 'absolute', left: 0, right: 0, top: 4, bottom: -4, opacity: 0.45 },
  face: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%' },
  rim: { ...StyleSheet.absoluteFill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  icon: { textShadowColor: 'rgba(0,0,0,0.18)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 3 },
});
