import Svg, { Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D carpentry icon — wooden toolbox with hammer and wood planks. */
export function CarpentryIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="ca_wood1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D4956A" />
          <Stop offset="0.5" stopColor="#B87A4F" />
          <Stop offset="1" stopColor="#8B5E3C" />
        </LinearGradient>
        <LinearGradient id="ca_wood2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E6A97A" />
          <Stop offset="0.5" stopColor="#C88B5E" />
          <Stop offset="1" stopColor="#9C6B42" />
        </LinearGradient>
        <LinearGradient id="ca_metal" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#E0E4EA" />
          <Stop offset="0.4" stopColor="#B8BFC8" />
          <Stop offset="1" stopColor="#878E98" />
        </LinearGradient>
        <LinearGradient id="ca_handle" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6B3E22" />
          <Stop offset="1" stopColor="#4A2A15" />
        </LinearGradient>
        <LinearGradient id="ca_plank" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F0C89A" />
          <Stop offset="0.5" stopColor="#D4A06A" />
          <Stop offset="1" stopColor="#B88850" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="30" ry="6" fill="#5C3A1E" opacity={0.12} />

      {/* Wood plank behind - diagonal */}
      <G transform="translate(60, 30) rotate(25)">
        <Rect x="-6" y="-24" width="12" height="48" rx="2" fill="url(#ca_plank)" />
        {/* Wood grain lines */}
        <Rect x="-4" y="-22" width="1" height="44" rx="0.5" fill="#C8924E" opacity={0.3} />
        <Rect x="0" y="-20" width="0.8" height="40" rx="0.4" fill="#C8924E" opacity={0.2} />
        <Rect x="3" y="-22" width="0.8" height="44" rx="0.4" fill="#C8924E" opacity={0.25} />
      </G>

      {/* Toolbox body */}
      <Rect x="16" y="48" width="56" height="34" rx="5" fill="url(#ca_wood1)" />
      {/* Toolbox front panel shading */}
      <Rect x="16" y="58" width="56" height="24" rx="0" fill="#8B5E3C" opacity={0.15} />
      {/* Toolbox highlight strip */}
      <Rect x="18" y="50" width="52" height="3" rx="1.5" fill="#FFFFFF" opacity={0.15} />
      {/* Wood grain */}
      <Rect x="20" y="52" width="48" height="1" rx="0.5" fill="#A86839" opacity={0.15} />
      <Rect x="20" y="62" width="48" height="1" rx="0.5" fill="#A86839" opacity={0.15} />
      <Rect x="20" y="72" width="48" height="1" rx="0.5" fill="#A86839" opacity={0.15} />

      {/* Toolbox lid */}
      <Rect x="14" y="42" width="60" height="10" rx="4" fill="url(#ca_wood2)" />
      <Rect x="16" y="43" width="56" height="3" rx="1.5" fill="#FFFFFF" opacity={0.12} />

      {/* Metal clasp */}
      <Rect x="38" y="56" width="12" height="10" rx="2" fill="url(#ca_metal)" />
      <Rect x="40" y="58" width="8" height="3" rx="1.5" fill="#FFFFFF" opacity={0.3} />

      {/* Handle */}
      <Path d="M36,42 L36,34 Q36,30 40,30 L48,30 Q52,30 52,34 L52,42" stroke="url(#ca_handle)" strokeWidth={5} fill="none" strokeLinecap="round" />
      {/* Handle highlight */}
      <Path d="M38,40 L38,35 Q38,32 41,32 L47,32" stroke="#FFFFFF" strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.25} />

      {/* Hammer head */}
      <G transform="translate(28, 26) rotate(-20)">
        <Rect x="-14" y="-6" width="28" height="12" rx="3" fill="url(#ca_metal)" />
        {/* Claw */}
        <Path d="M-14,-4 L-20,-10 M-14,4 L-20,10" stroke="#878E98" strokeWidth={3} fill="none" strokeLinecap="round" />
        {/* Highlight */}
        <Rect x="-12" y="-4" width="24" height="3" rx="1.5" fill="#FFFFFF" opacity={0.2} />
      </G>
      {/* Hammer handle */}
      <G transform="translate(28, 26) rotate(-20)">
        <Rect x="10" y="-3" width="28" height="6" rx="2" fill="url(#ca_handle)" />
        <Rect x="12" y="-2" width="24" height="2" rx="1" fill="#FFFFFF" opacity={0.1} />
      </G>

      {/* Sawdust particles */}
      <G opacity={0.4}>
        <Rect x="72" y="70" width="3" height="3" rx="0.5" fill="#D4A06A" transform="rotate(30 73 71)" />
        <Rect x="76" y="76" width="2" height="2" rx="0.5" fill="#E6B88A" transform="rotate(45 77 77)" />
        <Rect x="10" y="74" width="2.5" height="2.5" rx="0.5" fill="#D4A06A" transform="rotate(15 11 75)" />
      </G>
    </Svg>
  );
}
