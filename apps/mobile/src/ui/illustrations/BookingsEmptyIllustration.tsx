import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic empty bookings illustration — calendar with empty pages. */
export function BookingsEmptyIllustration({ size = 120 }: { size?: number }) {
  const h = size * (140 / 120);
  return (
    <Svg width={size} height={h} viewBox="0 0 120 140">
      <Defs>
        <LinearGradient id="be_cal" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#F0F4F8" />
        </LinearGradient>
        <LinearGradient id="be_top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="60" cy="132" rx="36" ry="6" fill="#0B6F55" opacity={0.08} />

      {/* Calendar back page */}
      <Rect x="18" y="24" width="84" height="100" rx="10" fill="#E4EBE8" />

      {/* Calendar main */}
      <Rect x="14" y="20" width="84" height="100" rx="10" fill="url(#be_cal)" />
      {/* Top strip */}
      <Rect x="14" y="20" width="84" height="28" rx="10" fill="url(#be_top)" />
      <Rect x="14" y="38" width="84" height="10" fill="url(#be_top)" />
      {/* Calendar rings */}
      <Rect x="34" y="14" width="6" height="16" rx="3" fill="#A0B0A8" />
      <Rect x="54" y="14" width="6" height="16" rx="3" fill="#A0B0A8" />
      <Rect x="74" y="14" width="6" height="16" rx="3" fill="#A0B0A8" />
      {/* Month text placeholder */}
      <Rect x="36" y="28" width="40" height="5" rx="2.5" fill="#FFFFFF" opacity={0.5} />

      {/* Grid lines */}
      <G opacity={0.15} stroke="#A0B0A8" strokeWidth={0.8}>
        <Path d="M28,60 H84" />
        <Path d="M28,72 H84" />
        <Path d="M28,84 H84" />
        <Path d="M28,96 H84" />
        <Path d="M42,52 V108" />
        <Path d="M56,52 V108" />
        <Path d="M70,52 V108" />
      </G>

      {/* Empty circle in center */}
      <Circle cx="56" cy="80" r="16" stroke="#C8D8D0" strokeWidth={2} fill="none" strokeDasharray="6 4" />

      {/* Clock icon */}
      <Circle cx="56" cy="80" r="8" fill="#E8F4EE" />
      <Path d="M56,75 V80 L60,82" stroke="#0B6F55" strokeWidth={2} fill="none" strokeLinecap="round" />

      {/* Decorative stars */}
      <Circle cx="100" cy="30" r="3" fill="#FFD700" opacity={0.4} />
      <Circle cx="106" cy="42" r="2" fill="#FFD700" opacity={0.3} />
      <Circle cx="10" cy="50" r="2.5" fill="#1FB187" opacity={0.3} />
    </Svg>
  );
}
