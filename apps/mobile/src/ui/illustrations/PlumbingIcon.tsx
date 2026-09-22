import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D plumbing icon — chrome wrench, blue pipe fitting, water droplets. */
export function PlumbingIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="pl_pipe" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#4BA3E3" />
          <Stop offset="0.5" stopColor="#2878BE" />
          <Stop offset="1" stopColor="#1A5A94" />
        </LinearGradient>
        <LinearGradient id="pl_pipe2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#5BB8F0" />
          <Stop offset="1" stopColor="#2272B8" />
        </LinearGradient>
        <LinearGradient id="pl_wrench" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#E8EDF2" />
          <Stop offset="0.3" stopColor="#C8D0DA" />
          <Stop offset="0.6" stopColor="#A8B4C2" />
          <Stop offset="1" stopColor="#7A8A9C" />
        </LinearGradient>
        <LinearGradient id="pl_wrenchHi" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.7" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="pl_drop" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#7DD3FC" />
          <Stop offset="1" stopColor="#0284C7" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="28" ry="6" fill="#1A5A94" opacity={0.12} />

      {/* Pipe - vertical */}
      <Rect x="36" y="20" width="18" height="50" rx="4" fill="url(#pl_pipe)" />
      {/* Pipe highlight */}
      <Rect x="38" y="20" width="5" height="50" rx="2" fill="#FFFFFF" opacity={0.2} />

      {/* Pipe - horizontal */}
      <Rect x="36" y="56" width="36" height="16" rx="4" fill="url(#pl_pipe2)" />
      {/* Pipe joint ring */}
      <Rect x="34" y="54" width="22" height="4" rx="2" fill="#1A5A94" />
      {/* Pipe highlight */}
      <Rect x="38" y="58" width="32" height="4" rx="2" fill="#FFFFFF" opacity={0.15} />

      {/* Pipe cap */}
      <Rect x="64" y="54" width="12" height="20" rx="3" fill="url(#pl_pipe)" />
      <Rect x="62" y="52" width="16" height="5" rx="2.5" fill="#1A5A94" />
      <Rect x="62" y="71" width="16" height="5" rx="2.5" fill="#1A5A94" />

      {/* Wrench */}
      <G transform="translate(50, 42) rotate(-35)">
        {/* Handle */}
        <Rect x="-5" y="-2" width="10" height="42" rx="3" fill="url(#pl_wrench)" />
        <Rect x="-4" y="-2" width="3" height="42" rx="1.5" fill="url(#pl_wrenchHi)" />
        {/* Grip lines */}
        <Rect x="-4" y="24" width="8" height="2" rx="1" fill="#6B7B8D" opacity={0.5} />
        <Rect x="-4" y="28" width="8" height="2" rx="1" fill="#6B7B8D" opacity={0.5} />
        <Rect x="-4" y="32" width="8" height="2" rx="1" fill="#6B7B8D" opacity={0.5} />
        {/* Head */}
        <Path d="M-8,-2 L-8,-14 L-3,-14 L-3,-2z" fill="url(#pl_wrench)" />
        <Path d="M3,-2 L3,-14 L8,-14 L8,-2z" fill="url(#pl_wrench)" />
        {/* Jaw opening */}
        <Rect x="-3" y="-14" width="6" height="8" fill="#4BA3E3" opacity={0.3} />
      </G>

      {/* Water droplets */}
      <Path d="M26,38 Q28,32 30,38 Q28,42 26,38z" fill="url(#pl_drop)" />
      <Circle cx="28" cy="36" r="1.2" fill="#FFFFFF" opacity={0.7} />

      <Path d="M22,48 Q23.5,44 25,48 Q23.5,51 22,48z" fill="url(#pl_drop)" opacity={0.7} />

      <Path d="M30,78 Q32,73 34,78 Q32,82 30,78z" fill="url(#pl_drop)" opacity={0.6} />
      <Circle cx="32" cy="76" r="1" fill="#FFFFFF" opacity={0.6} />
    </Svg>
  );
}
