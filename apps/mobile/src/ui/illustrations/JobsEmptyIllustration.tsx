import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic empty jobs illustration — briefcase with search icon. */
export function JobsEmptyIllustration({ size = 120 }: { size?: number }) {
  const h = size * (130 / 120);
  return (
    <Svg width={size} height={h} viewBox="0 0 120 130">
      <Defs>
        <LinearGradient id="jo_case" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="0.5" stopColor="#15926E" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
        <LinearGradient id="jo_clasp" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2C14E" />
          <Stop offset="1" stopColor="#CC9A20" />
        </LinearGradient>
        <LinearGradient id="jo_search" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#E0E4EA" />
          <Stop offset="1" stopColor="#A0A8B4" />
        </LinearGradient>
        <LinearGradient id="jo_glass" x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#E8F4FF" stopOpacity="0.8" />
          <Stop offset="1" stopColor="#B8D4F0" stopOpacity="0.4" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="58" cy="122" rx="34" ry="6" fill="#0B6F55" opacity={0.1} />

      {/* Briefcase back */}
      <Rect x="16" y="48" width="72" height="52" rx="10" fill="#0A5E48" opacity={0.3} />

      {/* Briefcase body */}
      <Rect x="12" y="44" width="72" height="52" rx="10" fill="url(#jo_case)" />
      {/* Body highlight */}
      <Rect x="14" y="46" width="68" height="8" rx="4" fill="#FFFFFF" opacity={0.12} />
      {/* Pocket */}
      <Rect x="20" y="68" width="56" height="22" rx="6" fill="#0A5E48" opacity={0.2} />
      <Rect x="22" y="70" width="52" height="3" rx="1.5" fill="#FFFFFF" opacity={0.08} />

      {/* Clasp */}
      <Rect x="38" y="60" width="20" height="14" rx="4" fill="url(#jo_clasp)" />
      <Rect x="42" y="63" width="12" height="4" rx="2" fill="#FFFFFF" opacity={0.3} />

      {/* Handle */}
      <Path d="M34,44 L34,34 Q34,26 42,26 L54,26 Q62,26 62,34 L62,44" stroke="#0A5E48" strokeWidth={6} fill="none" strokeLinecap="round" />
      <Path d="M36,42 L36,35 Q36,28 43,28 L53,28 Q60,28 60,35 L60,42" stroke="#FFFFFF" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.15} />

      {/* Magnifying glass — overlapping */}
      <G transform="translate(82, 74)">
        {/* Handle */}
        <Rect x="10" y="10" width="8" height="26" rx="4" fill="url(#jo_search)" transform="rotate(40 14 24)" />
        {/* Rim */}
        <Circle cx="0" cy="0" r="18" fill="none" stroke="url(#jo_search)" strokeWidth={5} />
        {/* Glass */}
        <Circle cx="0" cy="0" r="15" fill="url(#jo_glass)" />
        {/* Glass highlight */}
        <Path d="M-8,-10 Q-2,-14 6,-8" stroke="#FFFFFF" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.6} />
        {/* Question mark inside */}
        <Path d="M-3,-6 Q-3,-10 0,-10 Q4,-10 4,-6 Q4,-3 0,-2" stroke="#0B6F55" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.4} />
        <Circle cx="0" cy="3" r="1.5" fill="#0B6F55" opacity={0.4} />
      </G>

      {/* Dashed line circle — "waiting" */}
      <Circle cx="48" cy="70" r="24" stroke="#FFFFFF" strokeWidth={1.5} fill="none" strokeDasharray="4 4" opacity={0.2} />

      {/* Decorative elements */}
      <Circle cx="8" cy="36" r="3" fill="#FFD700" opacity={0.3} />
      <Circle cx="4" cy="28" r="2" fill="#FFD700" opacity={0.2} />
    </Svg>
  );
}
