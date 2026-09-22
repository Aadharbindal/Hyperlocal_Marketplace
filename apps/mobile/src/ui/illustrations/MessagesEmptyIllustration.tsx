import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic empty messages illustration — chat bubbles with no content. */
export function MessagesEmptyIllustration({ size = 120 }: { size?: number }) {
  const h = size * (130 / 120);
  return (
    <Svg width={size} height={h} viewBox="0 0 120 130">
      <Defs>
        <LinearGradient id="me_bub1" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
        <LinearGradient id="me_bub2" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#F0F4F8" />
        </LinearGradient>
        <LinearGradient id="me_phone" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E4E8EE" />
          <Stop offset="1" stopColor="#C5CAD4" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="60" cy="124" rx="34" ry="5" fill="#0B6F55" opacity={0.08} />

      {/* Phone body */}
      <Rect x="28" y="8" width="64" height="110" rx="12" fill="url(#me_phone)" />
      <Rect x="32" y="18" width="56" height="90" rx="4" fill="#FFFFFF" />
      {/* Notch */}
      <Rect x="46" y="10" width="28" height="5" rx="2.5" fill="#B0B8C4" opacity={0.5} />

      {/* Chat bubble 1 — left aligned (received) */}
      <G>
        <Rect x="38" y="28" width="36" height="18" rx="9" fill="url(#me_bub1)" />
        <Path d="M42,46 L38,52 L46,46" fill="url(#me_bub1)" />
        {/* Text lines */}
        <Rect x="44" y="34" width="22" height="3" rx="1.5" fill="#FFFFFF" opacity={0.6} />
        <Rect x="44" y="39" width="14" height="3" rx="1.5" fill="#FFFFFF" opacity={0.4} />
      </G>

      {/* Chat bubble 2 — right aligned (sent) */}
      <G>
        <Rect x="50" y="58" width="32" height="14" rx="7" fill="url(#me_bub2)" />
        <Path d="M78,72 L82,76 L74,72" fill="url(#me_bub2)" />
        {/* Text lines */}
        <Rect x="56" y="62" width="20" height="3" rx="1.5" fill="#C8D0DC" opacity={0.6} />
        <Rect x="56" y="67" width="12" height="3" rx="1.5" fill="#C8D0DC" opacity={0.4} />
        {/* Shadow for white bubble */}
        <Rect x="52" y="60" width="28" height="10" rx="5" fill="#0B6F55" opacity={0.04} />
      </G>

      {/* Empty typing area */}
      <Rect x="36" y="84" width="44" height="2" rx="1" fill="#E0E4EA" />
      <Circle cx="62" cy="85" r="4" fill="none" stroke="#C8D0DC" strokeWidth={1} strokeDasharray="3 2" />

      {/* Three dots — typing indicator placeholder */}
      <G opacity={0.3}>
        <Circle cx="50" cy="96" r="2.5" fill="#A0B0A8" />
        <Circle cx="58" cy="96" r="2.5" fill="#A0B0A8" />
        <Circle cx="66" cy="96" r="2.5" fill="#A0B0A8" />
      </G>

      {/* Decorative elements */}
      <Circle cx="18" cy="34" r="4" fill="#1FB187" opacity={0.15} />
      <Circle cx="12" cy="44" r="2.5" fill="#1FB187" opacity={0.1} />
      <Circle cx="102" cy="50" r="3.5" fill="#FFD700" opacity={0.2} />
      <Circle cx="108" cy="38" r="2" fill="#FFD700" opacity={0.15} />

      {/* Small paper plane */}
      <G transform="translate(104, 68) rotate(-20)">
        <Path d="M0,0 L12,-4 L4,2z" fill="#1FB187" opacity={0.3} />
        <Path d="M0,0 L4,2 L2,6z" fill="#0B6F55" opacity={0.25} />
      </G>
    </Svg>
  );
}
