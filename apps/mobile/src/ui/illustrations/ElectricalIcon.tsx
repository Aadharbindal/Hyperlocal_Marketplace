import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D electrical icon — glowing light bulb with sparks. */
export function ElectricalIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="el_glow" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#FFF7CC" />
          <Stop offset="0.4" stopColor="#FFE566" />
          <Stop offset="1" stopColor="#FFB800" />
        </LinearGradient>
        <LinearGradient id="el_glass" x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#FFFEF5" stopOpacity="0.9" />
          <Stop offset="0.5" stopColor="#FFF3B0" stopOpacity="0.6" />
          <Stop offset="1" stopColor="#FFD54F" stopOpacity="0.4" />
        </LinearGradient>
        <LinearGradient id="el_base" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D4D4D8" />
          <Stop offset="0.4" stopColor="#A1A1AA" />
          <Stop offset="1" stopColor="#71717A" />
        </LinearGradient>
        <LinearGradient id="el_filament" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#FF8C00" />
          <Stop offset="1" stopColor="#FFD700" />
        </LinearGradient>
        <LinearGradient id="el_spark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFE566" />
          <Stop offset="1" stopColor="#FF9500" />
        </LinearGradient>
      </Defs>

      {/* Outer glow */}
      <Circle cx="50" cy="44" r="36" fill="#FFE566" opacity={0.08} />
      <Circle cx="50" cy="44" r="28" fill="#FFE566" opacity={0.12} />

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="22" ry="5" fill="#CC8800" opacity={0.12} />

      {/* Bulb glass */}
      <Path d="M50,12 C66,12 78,26 78,44 C78,56 70,64 66,68 L64,72 L36,72 L34,68 C30,64 22,56 22,44 C22,26 34,12 50,12z" fill="url(#el_glass)" />
      {/* Bulb glass highlight */}
      <Path d="M38,20 C44,16 56,16 62,20 C58,24 46,28 38,20z" fill="#FFFFFF" opacity={0.5} />
      {/* Inner glow */}
      <Circle cx="50" cy="42" r="16" fill="url(#el_glow)" opacity={0.5} />

      {/* Filament */}
      <Path d="M44,50 L46,34 L48,44 L50,30 L52,44 L54,34 L56,50" stroke="url(#el_filament)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Base/screw */}
      <Rect x="36" y="70" width="28" height="6" rx="2" fill="url(#el_base)" />
      <Path d="M38,76 L38,82 Q38,86 42,86 L58,86 Q62,86 62,82 L62,76z" fill="url(#el_base)" />
      {/* Screw threads */}
      <Rect x="38" y="78" width="24" height="2" rx="1" fill="#8A8A8F" opacity={0.4} />
      <Rect x="39" y="82" width="22" height="2" rx="1" fill="#8A8A8F" opacity={0.4} />
      {/* Base highlight */}
      <Rect x="38" y="70" width="6" height="16" rx="1" fill="#FFFFFF" opacity={0.15} />
      {/* Contact point */}
      <Circle cx="50" cy="88" r="3" fill="#71717A" />

      {/* Sparks */}
      <G opacity={0.85}>
        {/* Right spark */}
        <Path d="M78,30 L84,26 L80,34 L86,32" stroke="url(#el_spark)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Left spark */}
        <Path d="M22,34 L16,30 L20,38 L14,36" stroke="url(#el_spark)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Top spark */}
        <Path d="M58,10 L62,4 L56,8 L60,2" stroke="url(#el_spark)" strokeWidth={2} fill="none" strokeLinecap="round" />
        {/* Small dots */}
        <Circle cx="82" cy="44" r="2" fill="#FFD700" opacity={0.6} />
        <Circle cx="18" cy="48" r="1.5" fill="#FFD700" opacity={0.5} />
        <Circle cx="70" cy="16" r="1.5" fill="#FFD700" opacity={0.5} />
      </G>
    </Svg>
  );
}
