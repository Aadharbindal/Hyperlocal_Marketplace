import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D general/default services icon — toolset with screwdriver and wrench. */
export function GeneralIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="ge_metal" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#E4E8EE" />
          <Stop offset="0.4" stopColor="#C0C8D4" />
          <Stop offset="1" stopColor="#8A96A6" />
        </LinearGradient>
        <LinearGradient id="ge_handle1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="1" stopColor="#0A5E48" />
        </LinearGradient>
        <LinearGradient id="ge_handle2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8C42" />
          <Stop offset="1" stopColor="#CC6620" />
        </LinearGradient>
        <LinearGradient id="ge_shield" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="0.5" stopColor="#15926E" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="28" ry="5" fill="#0A5E48" opacity={0.1} />

      {/* Wrench — left, diagonal */}
      <G transform="translate(34, 50) rotate(-40)">
        {/* Shaft */}
        <Rect x="-3.5" y="-6" width="7" height="50" rx="2" fill="url(#ge_metal)" />
        <Rect x="-2.5" y="-4" width="2.5" height="46" rx="1" fill="#FFFFFF" opacity={0.15} />
        {/* Head — open-end */}
        <Path d="M-8,-6 L-8,-18 L-4,-18 L-4,-6z" fill="url(#ge_metal)" />
        <Path d="M4,-6 L4,-18 L8,-18 L8,-6z" fill="url(#ge_metal)" />
        <Path d="M-6,-18 Q0,-22 6,-18" stroke="#8A96A6" strokeWidth={2} fill="none" />
        {/* Grip section */}
        <Rect x="-4" y="30" width="8" height="3" rx="1" fill="#8A96A6" opacity={0.3} />
        <Rect x="-4" y="35" width="8" height="3" rx="1" fill="#8A96A6" opacity={0.3} />
      </G>

      {/* Screwdriver — right, diagonal */}
      <G transform="translate(62, 48) rotate(35)">
        {/* Handle */}
        <Rect x="-5" y="4" width="10" height="36" rx="4" fill="url(#ge_handle2)" />
        <Rect x="-4" y="6" width="3" height="32" rx="1.5" fill="#FFFFFF" opacity={0.15} />
        {/* Handle ridges */}
        <Rect x="-4.5" y="14" width="9" height="2" rx="1" fill="#B85A1A" opacity={0.3} />
        <Rect x="-4.5" y="20" width="9" height="2" rx="1" fill="#B85A1A" opacity={0.3} />
        <Rect x="-4.5" y="26" width="9" height="2" rx="1" fill="#B85A1A" opacity={0.3} />
        {/* Ferrule */}
        <Rect x="-3.5" y="0" width="7" height="6" rx="1" fill="#A0A8B4" />
        <Rect x="-3" y="1" width="2" height="4" rx="1" fill="#FFFFFF" opacity={0.15} />
        {/* Shaft */}
        <Rect x="-2" y="-22" width="4" height="24" rx="1" fill="url(#ge_metal)" />
        <Rect x="-1.5" y="-20" width="1.5" height="20" rx="0.75" fill="#FFFFFF" opacity={0.2} />
        {/* Tip — flat head */}
        <Path d="M-3,-22 L-1,-28 L1,-28 L3,-22z" fill="#8A96A6" />
      </G>

      {/* Central shield badge */}
      <G transform="translate(50, 40)">
        <Path d="M0,-18 L16,-10 L16,6 Q16,18 0,24 Q-16,18 -16,6 L-16,-10z" fill="url(#ge_shield)" />
        {/* Shield highlight */}
        <Path d="M-2,-16 L14,-8 L14,0 Q8,-4 -2,-10z" fill="#FFFFFF" opacity={0.12} />
        {/* Check mark */}
        <Path d="M-6,2 L-1,8 L8,-4" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Inner border */}
        <Path d="M0,-14 L12,-7 L12,4 Q12,14 0,20 Q-12,14 -12,4 L-12,-7z" stroke="#FFFFFF" strokeWidth={1} fill="none" opacity={0.2} />
      </G>

      {/* Sparkles */}
      <Path d="M14,18 L16,14 L18,18 L22,20 L18,22 L16,26 L14,22 L10,20z" fill="#FFD700" opacity={0.5} />
      <Circle cx="84" cy="20" r="2" fill="#FFD700" opacity={0.4} />
      <Circle cx="80" cy="12" r="1.5" fill="#FFD700" opacity={0.3} />
    </Svg>
  );
}
