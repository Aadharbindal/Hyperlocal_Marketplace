import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { layout, palette, radius, spacing } from '@/theme';
import { Text } from './Text';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Announced as "Quantity for brass tap cartridge, 2" rather than just "2". */
  label: string;
  /** A unit shown beside the number: "pieces", "metres". */
  unit?: string;
}

/**
 * A small whole number, chosen rather than typed.
 *
 * Replaces the 62pt-wide numeric `TextInput` the material form used for quantity. Three reasons
 * that was the wrong control: it opens a keyboard that covers half the screen to change a 1 into a
 * 2; it can hold an empty string, which the form then has to decide the meaning of; and it let
 * somebody send a supplier a request for 999 tap cartridges by holding a key down.
 *
 * The number itself is still selectable text, so a screen reader reads the current value as part of
 * the group rather than requiring somebody to find it between two unlabelled buttons.
 */
export function Stepper({ value, onChange, min = 1, max = 99, label, unit }: Props) {
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    // The one place a tick is worth it: the control is small, the target is small, and the only
    // other feedback is a single digit changing.
    void Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  return (
    <View style={styles.wrap} accessibilityLabel={`${label}, ${value}${unit ? ` ${unit}` : ''}`}>
      <Pressable
        onPress={() => step(-1)}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel={`Fewer, ${label}`}
        hitSlop={6}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, value <= min && styles.off]}
      >
        <Ionicons name="remove" size={18} color={value <= min ? palette.iconFaint : palette.primaryDeep} />
      </Pressable>

      <View style={styles.valueBox}>
        <Text variant="label" weight="bold">
          {value}
        </Text>
        {unit ? (
          <Text variant="micro" tone="muted">
            {unit}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => step(1)}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel={`More, ${label}`}
        hitSlop={6}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, value >= max && styles.off]}
      >
        <Ionicons name="add" size={18} color={value >= max ? palette.iconFaint : palette.primaryDeep} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.pill,
    padding: spacing.xxs,
  },
  btn: {
    width: layout.touchTarget - 8,
    height: layout.touchTarget - 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.92 }] },
  off: { backgroundColor: 'transparent' },
  valueBox: { minWidth: 44, alignItems: 'center', gap: 0 },
});
