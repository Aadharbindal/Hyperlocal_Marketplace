import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { layout, palette, radius, spacing } from '@/theme';
import { Text } from './Text';

// ---------------------------------------------------------------------------
// IconChip - pastel rounded square with a saturated icon (category tiles, offer card)
// ---------------------------------------------------------------------------
export function IconChip({ icon, bg, fg, size = layout.iconChip, style }: { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string; size?: number; style?: ViewStyle }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name={icon} size={size * 0.5} color={fg} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// IconButton - circular tappable icon (bell, chevron, filters)
// ---------------------------------------------------------------------------
export function IconButton({ icon, onPress, tone = 'muted', badge, accessibilityLabel, size = layout.touchTarget }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; tone?: 'muted' | 'primary' | 'plain'; badge?: boolean; accessibilityLabel: string; size?: number }) {
  const bg = tone === 'primary' ? palette.primarySoft : tone === 'muted' ? palette.surfaceMuted : 'transparent';
  const fg = tone === 'primary' ? palette.primary : palette.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={size * 0.5} color={fg} />
      {badge ? <View style={styles.badgeDot} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badge / Pill
// ---------------------------------------------------------------------------
type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  primary: { bg: palette.primarySoft, fg: palette.primaryDeep },
  success: { bg: palette.successSoft, fg: palette.success },
  warning: { bg: palette.warningSoft, fg: '#8A6400' },
  danger: { bg: palette.dangerSoft, fg: palette.danger },
  info: { bg: palette.infoSoft, fg: palette.info },
  neutral: { bg: palette.surfaceMuted, fg: palette.textSecondary },
};
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: BadgeTone; icon?: keyof typeof Ionicons.glyphMap }) {
  const c = BADGE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={c.fg} /> : null}
      <Text variant="micro" weight="semibold" style={{ color: c.fg }}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar - initials fallback
// ---------------------------------------------------------------------------
export function Avatar({ name, size = layout.avatar }: { name: string | null | undefined; size?: number }) {
  const initials = (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: palette.surface }}>
      <Text variant="label" weight="bold" tone="primary">
        {initials || '?'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader - "Service Categories   View All ->"
// ---------------------------------------------------------------------------
export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="heading">{title}</Text>
      {actionLabel ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text variant="label" tone="primary" weight="semibold">
            {actionLabel}
          </Text>
          <Ionicons name="arrow-forward" size={16} color={palette.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dots - carousel indicator
// ---------------------------------------------------------------------------
export function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={styles.dots} accessibilityElementsHidden>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === active && styles.dotActive]} />
      ))}
    </View>
  );
}

export function Spacer({ h = spacing.lg }: { h?: number }) {
  return <View style={{ height: h }} />;
}

const styles = StyleSheet.create({
  badgeDot: { position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: palette.danger, borderWidth: 1.5, borderColor: palette.surface },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.md },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.borderStrong },
  dotActive: { width: 18, backgroundColor: palette.primary },
});
