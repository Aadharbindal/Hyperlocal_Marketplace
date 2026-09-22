import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** Realistic 3D cleaning icon — mop, spray bottle, and sparkles. */
export function CleaningIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="cl_bucket" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#5CC5A0" />
          <Stop offset="0.5" stopColor="#2DA87A" />
          <Stop offset="1" stopColor="#1C7A5A" />
        </LinearGradient>
        <LinearGradient id="cl_spray" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7DD3FC" />
          <Stop offset="0.5" stopColor="#38BDF8" />
          <Stop offset="1" stopColor="#0EA5E9" />
        </LinearGradient>
        <LinearGradient id="cl_handle" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A8A8B0" />
          <Stop offset="1" stopColor="#6B6B78" />
        </LinearGradient>
        <LinearGradient id="cl_foam" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E8F4FF" />
        </LinearGradient>
        <LinearGradient id="cl_mop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F5F5F5" />
          <Stop offset="1" stopColor="#D4D4D8" />
        </LinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx="50" cy="92" rx="30" ry="6" fill="#1C7A5A" opacity={0.1} />

      {/* Bucket */}
      <Path d="M24,50 L20,84 Q20,88 24,88 L56,88 Q60,88 60,84 L56,50z" fill="url(#cl_bucket)" />
      {/* Bucket rim */}
      <Rect x="18" y="46" width="44" height="8" rx="4" fill="#2DA87A" />
      <Rect x="20" y="47" width="40" height="3" rx="1.5" fill="#FFFFFF" opacity={0.2} />
      {/* Bucket stripe */}
      <Rect x="22" y="64" width="36" height="4" rx="2" fill="#FFFFFF" opacity={0.15} />
      {/* Bucket handle */}
      <Path d="M24,46 Q24,30 40,30 Q56,30 56,46" stroke="url(#cl_handle)" strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M26,44 Q26,32 40,32 Q54,32 54,44" stroke="#FFFFFF" strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.2} />

      {/* Foam bubbles on top */}
      <Circle cx="30" cy="48" r="5" fill="url(#cl_foam)" opacity={0.8} />
      <Circle cx="40" cy="46" r="6" fill="url(#cl_foam)" opacity={0.85} />
      <Circle cx="50" cy="48" r="5" fill="url(#cl_foam)" opacity={0.8} />
      <Circle cx="35" cy="44" r="3.5" fill="url(#cl_foam)" opacity={0.7} />
      <Circle cx="45" cy="43" r="4" fill="url(#cl_foam)" opacity={0.75} />
      {/* Bubble highlights */}
      <Circle cx="38" cy="44" r="1.2" fill="#FFFFFF" opacity={0.6} />
      <Circle cx="48" cy="46" r="1" fill="#FFFFFF" opacity={0.5} />

      {/* Spray bottle */}
      <G transform="translate(68, 32)">
        {/* Body */}
        <Rect x="-8" y="10" width="16" height="32" rx="4" fill="url(#cl_spray)" />
        <Rect x="-6" y="12" width="4" height="28" rx="2" fill="#FFFFFF" opacity={0.15} />
        {/* Neck */}
        <Rect x="-4" y="2" width="8" height="10" rx="2" fill="#A8A8B0" />
        {/* Trigger */}
        <Path d="M4,4 L12,4 L12,12 L8,16 L4,12z" fill="#FF6B6B" opacity={0.8} />
        <Path d="M5,5 L10,5 L10,10" stroke="#FFFFFF" strokeWidth={1} fill="none" opacity={0.3} />
        {/* Nozzle */}
        <Rect x="8" y="0" width="10" height="4" rx="2" fill="#A8A8B0" />
        {/* Label */}
        <Rect x="-5" y="24" width="10" height="8" rx="2" fill="#FFFFFF" opacity={0.3} />
      </G>

      {/* Mop stick */}
      <Rect x="12" y="8" width="4" height="48" rx="2" fill="url(#cl_handle)" />
      <Rect x="12.5" y="10" width="1.5" height="44" rx="0.75" fill="#FFFFFF" opacity={0.15} />
      {/* Mop head */}
      <Path d="M6,54 Q14,50 22,54 L20,68 Q14,72 8,68z" fill="url(#cl_mop)" />
      <Path d="M8,56 L8,66M12,55 L12,68M16,55 L16,68M20,56 L20,66" stroke="#B8B8C0" strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />

      {/* Sparkles */}
      <G>
        {/* Star sparkle 1 */}
        <Path d="M78,14 L80,10 L82,14 L86,16 L82,18 L80,22 L78,18 L74,16z" fill="#FFD700" opacity={0.7} />
        {/* Star sparkle 2 */}
        <Path d="M88,38 L89,36 L90,38 L92,39 L90,40 L89,42 L88,40 L86,39z" fill="#FFD700" opacity={0.5} />
        {/* Star sparkle 3 */}
        <Path d="M64,10 L65,8 L66,10 L68,11 L66,12 L65,14 L64,12 L62,11z" fill="#FFD700" opacity={0.6} />
        {/* Small dots */}
        <Circle cx="72" cy="22" r="1.5" fill="#FFD700" opacity={0.4} />
        <Circle cx="86" cy="28" r="1" fill="#FFD700" opacity={0.3} />
      </G>
    </Svg>
  );
}
