import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D offer illustration — gift box with ribbon. */
export function OfferIllustration({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="of_box" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="0.5" stopColor="#15926E" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
        <LinearGradient id="of_lid" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#25D3A1" />
          <Stop offset="1" stopColor="#18A57D" />
        </LinearGradient>
        <LinearGradient id="of_ribbon" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD700" />
          <Stop offset="1" stopColor="#FF8C00" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="88" rx="30" ry="6" fill="#0B6F55" opacity={0.15} />

      {/* Box body */}
      <Rect x="20" y="44" width="60" height="40" rx="4" fill="url(#of_box)" />
      {/* Box highlight */}
      <Rect x="22" y="44" width="56" height="4" rx="2" fill="#FFFFFF" opacity={0.15} />

      {/* Vertical ribbon */}
      <Rect x="44" y="44" width="12" height="40" fill="url(#of_ribbon)" />
      <Rect x="46" y="44" width="2" height="40" fill="#FFFFFF" opacity={0.3} />

      {/* Lid */}
      <Rect x="16" y="34" width="68" height="14" rx="3" fill="url(#of_lid)" />
      <Rect x="18" y="36" width="64" height="2" rx="1" fill="#FFFFFF" opacity={0.2} />
      <Rect x="16" y="46" width="68" height="2" fill="#0A5E48" opacity={0.3} />

      {/* Lid vertical ribbon */}
      <Rect x="44" y="34" width="12" height="14" fill="url(#of_ribbon)" />
      <Rect x="46" y="34" width="2" height="14" fill="#FFFFFF" opacity={0.3} />

      {/* Bow */}
      <G transform="translate(50, 32)">
        {/* Left loop */}
        <Path d="M0,4 C-10,-4 -24,4 -14,14 C-8,20 0,4 0,4z" fill="url(#of_ribbon)" />
        <Path d="M-4,6 C-10,2 -18,6 -12,12" stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.3} />
        {/* Right loop */}
        <Path d="M0,4 C10,-4 24,4 14,14 C8,20 0,4 0,4z" fill="url(#of_ribbon)" />
        <Path d="M4,6 C10,2 18,6 12,12" stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.3} />
        {/* Center knot */}
        <Rect x="-6" y="-2" width="12" height="10" rx="3" fill="url(#of_ribbon)" />
        <Rect x="-4" y="0" width="8" height="2" rx="1" fill="#FFFFFF" opacity={0.4} />
      </G>

      {/* Confetti */}
      <Circle cx="14" cy="20" r="3" fill="#E5484D" opacity={0.8} />
      <Circle cx="86" cy="24" r="2.5" fill="#2F6FED" opacity={0.8} />
      <Circle cx="24" cy="12" r="2" fill="#FFD700" opacity={0.8} />
      <Circle cx="76" cy="10" r="3" fill="#1FB187" opacity={0.8} />
    </Svg>
  );
}
