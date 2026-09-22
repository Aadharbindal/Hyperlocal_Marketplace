import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** A modern 3D illustration for the home screen hero banner — a floating house with tools. */
export function HomeHeroIllustration({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.container, style]}>
      <Svg width="140" height="140" viewBox="0 0 140 140">
        <Defs>
          <LinearGradient id="hh_houseFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#E0E8F0" />
          </LinearGradient>
          <LinearGradient id="hh_houseSide" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#D0D8E0" />
            <Stop offset="1" stopColor="#B0B8C0" />
          </LinearGradient>
          <LinearGradient id="hh_roofFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1FB187" />
            <Stop offset="1" stopColor="#0A5E48" />
          </LinearGradient>
          <LinearGradient id="hh_roofSide" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#15926E" />
            <Stop offset="1" stopColor="#084232" />
          </LinearGradient>
          <LinearGradient id="hh_window" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFD700" />
            <Stop offset="1" stopColor="#FF8C00" />
          </LinearGradient>
        </Defs>

        {/* Shadow */}
        <Ellipse cx="70" cy="120" rx="40" ry="10" fill="#053322" opacity={0.2} />

        <G transform="translate(10, 10)">
          {/* Main house body - isometric */}
          {/* Right side (shaded) */}
          <Path d="M60,60 L90,45 L90,85 L60,100 Z" fill="url(#hh_houseSide)" />
          {/* Front side */}
          <Path d="M20,45 L60,60 L60,100 L20,85 Z" fill="url(#hh_houseFront)" />
          {/* Front windows */}
          <Path d="M30,55 L40,59 L40,69 L30,65 Z" fill="url(#hh_window)" />
          <Path d="M46,61 L54,64 L54,74 L46,71 Z" fill="url(#hh_window)" />
          
          {/* Door */}
          <Path d="M36,75 L48,80 L48,95 L36,90 Z" fill="#2C3E50" />
          <Circle cx="45" cy="88" r="1.5" fill="#FFFFFF" opacity={0.8} />

          {/* Roof */}
          {/* Right side roof */}
          <Path d="M60,25 L98,40 L90,45 L52,30 Z" fill="url(#hh_roofSide)" />
          {/* Front side roof */}
          <Path d="M20,45 L60,60 L60,25 L20,45 Z" fill="url(#hh_roofFront)" />
          {/* Roof overhang */}
          <Path d="M16,47 L62,64 L60,60 L20,45 Z" fill="#1FB187" />
          <Path d="M62,64 L102,44 L98,40 L60,60 Z" fill="#15926E" />

          {/* Floating elements */}
          {/* Wrench */}
          <G transform="translate(85, 20) rotate(15)">
            <Rect x="-4" y="0" width="8" height="24" rx="3" fill="#C5CAD4" />
            <Circle cx="0" cy="0" r="7" fill="#C5CAD4" />
            <Circle cx="0" cy="0" r="3" fill="#FFFFFF" />
            <Circle cx="0" cy="24" r="6" fill="#C5CAD4" />
            <Rect x="-6" y="24" width="12" height="6" fill="#FFFFFF" opacity={0.3} />
          </G>

          {/* Paintbrush */}
          <G transform="translate(15, 20) rotate(-20)">
            <Rect x="-3" y="0" width="6" height="20" rx="2" fill="#E85D8A" />
            <Rect x="-4" y="20" width="8" height="6" rx="1" fill="#C5CAD4" />
            <Path d="M-4,26 L4,26 L5,40 L-5,40 Z" fill="#FFD700" />
          </G>
        </G>

        {/* Sparkles */}
        <Circle cx="20" cy="20" r="3" fill="#FFFFFF" opacity={0.8} />
        <Circle cx="120" cy="30" r="2" fill="#FFFFFF" opacity={0.6} />
        <Circle cx="110" cy="110" r="2.5" fill="#FFFFFF" opacity={0.7} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
