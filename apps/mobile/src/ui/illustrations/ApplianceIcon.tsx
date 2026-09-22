import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D appliance repair icon — washing machine with gears. */
export function ApplianceIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="ap_body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F0F2F5" />
          <Stop offset="0.5" stopColor="#DDE1E8" />
          <Stop offset="1" stopColor="#C5CAD4" />
        </LinearGradient>
        <LinearGradient id="ap_door" x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#E8ECF2" stopOpacity="0.9" />
          <Stop offset="0.5" stopColor="#C8D0DC" stopOpacity="0.7" />
          <Stop offset="1" stopColor="#A0AABC" stopOpacity="0.5" />
        </LinearGradient>
        <LinearGradient id="ap_gear" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#8B9AAE" />
          <Stop offset="0.5" stopColor="#6B7A90" />
          <Stop offset="1" stopColor="#4A5A70" />
        </LinearGradient>
        <LinearGradient id="ap_accent" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1FB187" />
          <Stop offset="1" stopColor="#0B6F55" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="44" cy="92" rx="28" ry="6" fill="#4A5A70" opacity={0.1} />

      {/* Machine body */}
      <Rect x="16" y="14" width="56" height="72" rx="7" fill="url(#ap_body)" />
      {/* Body side shade */}
      <Rect x="64" y="16" width="6" height="68" rx="2" fill="#B0B8C4" opacity={0.3} />
      {/* Top panel line */}
      <Rect x="18" y="30" width="52" height="1.5" rx="0.75" fill="#B0B8C4" opacity={0.5} />

      {/* Control panel area */}
      {/* Knob 1 */}
      <Circle cx="28" cy="22" r="4" fill="url(#ap_accent)" />
      <Circle cx="28" cy="22" r="2" fill="#FFFFFF" opacity={0.3} />
      {/* Knob 2 */}
      <Circle cx="40" cy="22" r="3" fill="#A0AABC" />
      <Circle cx="40" cy="22" r="1.5" fill="#FFFFFF" opacity={0.25} />
      {/* LED */}
      <Rect x="50" y="20" width="8" height="4" rx="2" fill="#0B6F55" opacity={0.7} />
      <Rect x="51" y="21" width="3" height="2" rx="1" fill="#4AE6B8" opacity={0.8} />
      {/* Button */}
      <Circle cx="64" cy="22" r="3.5" fill="#E5484D" opacity={0.8} />
      <Circle cx="64" cy="21.5" r="2" fill="#FFFFFF" opacity={0.2} />

      {/* Door - circular */}
      <Circle cx="44" cy="58" r="22" fill="url(#ap_door)" />
      <Circle cx="44" cy="58" r="20" stroke="#B0B8C4" strokeWidth={1.5} fill="none" />
      {/* Inner drum visible */}
      <Circle cx="44" cy="58" r="16" fill="#DDE1E8" opacity={0.5} />
      {/* Door glass reflection */}
      <Path d="M34,46 Q38,42 48,44 Q42,52 34,46z" fill="#FFFFFF" opacity={0.35} />
      {/* Door handle */}
      <Rect x="62" y="54" width="6" height="8" rx="3" fill="#A0AABC" />
      <Rect x="63" y="55" width="2" height="6" rx="1" fill="#FFFFFF" opacity={0.2} />
      {/* Clothes visible */}
      <Path d="M36,52 Q40,48 48,54 Q44,62 36,56z" fill="#4BA3E3" opacity={0.25} />
      <Path d="M42,60 Q48,56 52,62 Q46,66 42,60z" fill="#E0457B" opacity={0.2} />

      {/* Gear icon - top right */}
      <G transform="translate(78, 28)">
        <Circle cx="0" cy="0" r="10" fill="url(#ap_gear)" opacity={0.9} />
        {/* Gear teeth */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
          <Rect key={i} x="-2" y="-12" width="4" height="5" rx="1" fill="url(#ap_gear)" transform={`rotate(${angle})`} />
        ))}
        <Circle cx="0" cy="0" r="4.5" fill="#C5CAD4" />
        <Circle cx="0" cy="0" r="2.5" fill="url(#ap_gear)" />
        {/* Highlight */}
        <Path d="M-6,-6 Q-2,-8 4,-4" stroke="#FFFFFF" strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.3} />
      </G>

      {/* Small wrench icon */}
      <G transform="translate(80, 46) rotate(30)">
        <Rect x="-2" y="-8" width="4" height="16" rx="1.5" fill="#8B9AAE" />
        <Path d="M-4,-8 L-4,-13 L-1,-13 L-1,-8z" fill="#8B9AAE" />
        <Path d="M1,-8 L1,-13 L4,-13 L4,-8z" fill="#8B9AAE" />
      </G>

      {/* Legs */}
      <Rect x="20" y="84" width="6" height="4" rx="1" fill="#8B9AAE" />
      <Rect x="62" y="84" width="6" height="4" rx="1" fill="#8B9AAE" />
    </Svg>
  );
}
