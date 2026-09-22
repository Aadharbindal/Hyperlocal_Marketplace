import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D painting icon — paint roller, paint can, and color splashes. */
export function PaintingIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="pa_roller" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E85D8A" />
          <Stop offset="0.5" stopColor="#D63F72" />
          <Stop offset="1" stopColor="#B52E5C" />
        </LinearGradient>
        <LinearGradient id="pa_can" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E0E4EA" />
          <Stop offset="0.5" stopColor="#C5CAD4" />
          <Stop offset="1" stopColor="#A0A8B4" />
        </LinearGradient>
        <LinearGradient id="pa_paint" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#FFB347" />
          <Stop offset="1" stopColor="#FF8C00" />
        </LinearGradient>
        <LinearGradient id="pa_handle" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A0A8B4" />
          <Stop offset="1" stopColor="#6B7380" />
        </LinearGradient>
        <LinearGradient id="pa_blue" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#60A5FA" />
          <Stop offset="1" stopColor="#2563EB" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="28" ry="5" fill="#6B3050" opacity={0.1} />

      {/* Paint can */}
      <Rect x="42" y="52" width="36" height="34" rx="4" fill="url(#pa_can)" />
      {/* Can lip */}
      <Rect x="40" y="48" width="40" height="8" rx="4" fill="#C5CAD4" />
      <Rect x="42" y="49" width="36" height="3" rx="1.5" fill="#FFFFFF" opacity={0.2} />
      {/* Can label */}
      <Rect x="46" y="60" width="28" height="18" rx="3" fill="#FFFFFF" opacity={0.25} />
      <Rect x="50" y="64" width="20" height="3" rx="1.5" fill="#FF8C00" opacity={0.6} />
      <Rect x="50" y="70" width="14" height="2" rx="1" fill="#A0A8B4" opacity={0.3} />
      {/* Can handle */}
      <Path d="M48,48 Q48,38 60,38 Q72,38 72,48" stroke="url(#pa_handle)" strokeWidth={3} fill="none" strokeLinecap="round" />

      {/* Paint drip from can */}
      <Path d="M76,56 Q78,56 78,60 L78,70 Q78,74 76,74 Q74,74 74,70 L74,60 Q74,56 76,56z" fill="url(#pa_paint)" />
      <Circle cx="76" cy="76" r="3" fill="url(#pa_paint)" />

      {/* Paint inside can */}
      <Ellipse cx="60" cy="54" rx="16" ry="4" fill="url(#pa_paint)" opacity={0.8} />
      <Ellipse cx="58" cy="53" rx="8" ry="2" fill="#FFFFFF" opacity={0.2} />

      {/* Roller */}
      <G transform="translate(28, 20) rotate(-15)">
        {/* Handle */}
        <Rect x="-3" y="14" width="6" height="46" rx="2" fill="url(#pa_handle)" />
        <Rect x="-2" y="16" width="2" height="42" rx="1" fill="#FFFFFF" opacity={0.15} />
        {/* Handle grip */}
        <Rect x="-4" y="50" width="8" height="12" rx="3" fill="#5A5A68" />
        <Rect x="-3" y="52" width="2" height="8" rx="1" fill="#FFFFFF" opacity={0.12} />
        {/* Frame */}
        <Path d="M-3,14 L-12,14 L-12,8z" fill="url(#pa_handle)" />
        <Path d="M3,14 L12,14 L12,8z" fill="url(#pa_handle)" />
        {/* Roller cylinder */}
        <Rect x="-14" y="-8" width="28" height="18" rx="9" fill="url(#pa_roller)" />
        {/* Roller texture */}
        <Rect x="-12" y="-4" width="24" height="2" rx="1" fill="#FFFFFF" opacity={0.1} />
        <Rect x="-12" y="0" width="24" height="2" rx="1" fill="#FFFFFF" opacity={0.08} />
        <Rect x="-12" y="4" width="24" height="2" rx="1" fill="#FFFFFF" opacity={0.1} />
        {/* Roller highlight */}
        <Rect x="-12" y="-6" width="24" height="4" rx="2" fill="#FFFFFF" opacity={0.2} />
      </G>

      {/* Paint splash spots */}
      <Circle cx="20" cy="78" r="4" fill="url(#pa_blue)" opacity={0.5} />
      <Circle cx="16" cy="82" r="2.5" fill="url(#pa_blue)" opacity={0.35} />
      <Circle cx="32" cy="84" r="3" fill="#E85D8A" opacity={0.4} />
      <Circle cx="38" cy="88" r="2" fill="#E85D8A" opacity={0.3} />

      {/* Color swatch dots */}
      <Circle cx="86" cy="14" r="5" fill="#60A5FA" opacity={0.6} />
      <Circle cx="90" cy="24" r="3.5" fill="#34D399" opacity={0.5} />
      <Circle cx="82" cy="22" r="3" fill="#FBBF24" opacity={0.5} />
    </Svg>
  );
}
