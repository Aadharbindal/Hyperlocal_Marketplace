import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { layout, palette, radius, spacing } from '@/theme';
import { Badge } from './primitives';
import { Text } from './Text';

/**
 * The three shapes that had been written twelve times.
 *
 * Five screens declared a local `Stat`, seven declared a local `Row`, and no two agreed: different
 * gaps, different weights, two of them put the value on the left, and the money rows disagreed
 * about whether a total gets a rule above it. None of that is a bug anybody would file, and all of
 * it is why a product reads as several products.
 */

type Tone = 'default' | 'muted' | 'danger' | 'success' | 'primary';

interface DataRowProps {
  label: string;
  value: string;
  /** The value's tone. The label stays secondary throughout - it is never the point of the row. */
  tone?: Tone;
  /** A total. Draws the rule above it and sets both sides bold. */
  total?: boolean;
  /** A line of explanation under the label, for a fee somebody is entitled to question. */
  note?: string;
}

/**
 * `label .......... value`, the shape every price breakdown and detail list is made of.
 *
 * `total` exists because a breakdown that ends without a visible break reads as one more line item,
 * and the number somebody actually cares about is the one they then have to hunt for.
 */
export function DataRow({ label, value, tone = 'default', total, note }: DataRowProps) {
  return (
    <View style={[styles.dataRow, total && styles.totalRow]}>
      <View style={styles.dataLabel}>
        <Text variant={total ? 'label' : 'caption'} weight={total ? 'bold' : 'regular'} tone={total ? 'default' : 'secondary'}>
          {label}
        </Text>
        {note ? (
          <Text variant="micro" tone="muted">
            {note}
          </Text>
        ) : null}
      </View>
      <Text
        variant={total ? 'label' : 'caption'}
        weight={total ? 'bold' : 'semibold'}
        tone={tone === 'default' ? 'default' : tone}
      >
        {value}
      </Text>
    </View>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  /** One short line under the number: what it counts, or when it resets. */
  hint?: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/**
 * One number, with its name under it.
 *
 * The number is first and largest, because in every place this is used - earnings, referrals,
 * ratings, the admin money screen - somebody is scanning a row of them for the one that changed.
 * The label is set in `micro` and `muted` on purpose: at tile size a label competing with the
 * figure makes a wall of grey text where there should be three numbers.
 */
export function StatTile({ label, value, hint, tone = 'default', icon, style }: StatTileProps) {
  return (
    <View
      style={[styles.tile, style]}
      // Read as one thing. Without this a screen reader announces "1,240" and "Earned" as two
      // unrelated labels, and in a row of four tiles the pairing is lost.
      accessible
      accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ''}`}
    >
      {icon ? (
        <View style={styles.tileIcon}>
          <Ionicons name={icon} size={15} color={palette.primaryDeep} />
        </View>
      ) : null}
      <Text variant="heading" weight="bold" tone={tone === 'default' ? 'default' : tone}>
        {value}
      </Text>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      {hint ? (
        <Text variant="micro" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** A third line, for the thing somebody needs but should not read first. */
  meta?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** The icon chip's colours. Defaults to the brand mint. */
  iconBg?: string;
  iconFg?: string;
  /** A short status word on the right. */
  badge?: { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' };
  onPress?: () => void;
  /** Shown instead of the chevron - a delete button, a switch. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Icon, two or three lines, something on the right.
 *
 * Nine screens built this by hand out of a `Card` and a flex row. The version that matters is the
 * accessibility one: as a `Pressable` wrapping four `Text` nodes, a screen reader walks them one at
 * a time and the row never announces itself as a single tappable thing. Here the whole row is one
 * element with one label, and the chevron is hidden from the reader because "chevron forward" is
 * not information.
 */
export function ListRow({
  title,
  subtitle,
  meta,
  icon,
  iconBg = palette.primarySoft,
  iconFg = palette.primaryDeep,
  badge,
  onPress,
  trailing,
  style,
}: ListRowProps) {
  const body = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]} importantForAccessibility="no-hide-descendants">
          <Ionicons name={icon} size={19} color={iconFg} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text variant="label" weight="semibold" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {badge ? <Badge tone={badge.tone} label={badge.label} /> : null}
      {trailing ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} importantForAccessibility="no" />
        ) : null)}
    </>
  );

  if (!onPress) return <View style={[styles.row, style]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessible
      accessibilityLabel={[title, subtitle, meta, badge?.label].filter(Boolean).join('. ')}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dataRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, minHeight: 24 },
  dataLabel: { flex: 1, gap: 1 },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    alignItems: 'center',
  },
  tile: {
    flex: 1,
    gap: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.touchTarget,
    paddingVertical: spacing.xs,
  },
  rowPressed: { opacity: 0.6 },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
});
