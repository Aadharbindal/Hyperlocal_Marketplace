import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { layout, palette, radius, spacing } from '@/theme';
import { Text } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** A second line under the label - "about 2 hours", "most people pick this". */
  hint?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Announced before the options, so a screen reader says what the group is choosing. */
  label?: string;
  /**
   * Lay the options out one per row instead of in a line.
   *
   * For anything with a `hint`, or more than about four options: a horizontal strip of five chips
   * on a 360pt phone gives each one 60pt, which truncates every label into uselessness.
   */
  stacked?: boolean;
  /** Let a long row scroll sideways rather than wrapping. Ignored when `stacked`. */
  scroll?: boolean;
  /**
   * Share the row equally between the options instead of letting each one size to its label.
   *
   * For a small, closed set that belongs on one line - Home / Work / Other, UPI / Bank. Those three
   * chips with their icons came to about 370pt against 335pt of room, so the last one dropped to a
   * second row and a three-way choice looked like a two-way choice with an afterthought. Equal
   * widths also stop the selected chip shifting its neighbours as it changes weight.
   *
   * Only for short sets: four or more, or anything with a long label, is better scrolled or stacked
   * than squeezed.
   */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Picking one of a few.
 *
 * This existed eight times before it existed once. Eight screens had their own `styles.chip` and
 * `styles.chipOn`, and they had drifted into eight different controls: three paddings, two radii,
 * two different ways of colouring the selected one, and - the part that actually mattered - only
 * two of them told a screen reader that the row was a group of choices rather than eight unrelated
 * buttons, so the rest announced "Partial refund, button" with no hint that picking it unpicked
 * something else.
 *
 * `accessibilityRole="radio"` inside a `radiogroup` is the whole point of having this in one place.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  stacked,
  scroll,
  fill,
  style,
}: Props<T>) {
  /**
   * No Reanimated here, deliberately.
   *
   * The first version eased the chips' width with `LinearTransition`, which cost about nothing to
   * look at and a great deal structurally: this control is exported from the `@/ui` barrel, so a
   * reanimated import in it put the worklet runtime behind *every* screen and every component test
   * that touches the kit - and the UI suite stopped being able to run at all. A primitive used
   * everywhere should not drag the animation runtime in with it. The press state below is a plain
   * transform, which is the part anybody actually feels.
   */
  const chips = options.map((o) => {
    const on = o.value === value;
    return (
      <View key={o.value} style={stacked ? styles.stackedItem : fill ? styles.fillItem : undefined}>
        <Pressable
          onPress={() => !o.disabled && onChange(o.value)}
          accessibilityRole="radio"
          /**
           * Both spellings, because the two platforms read different ones.
           *
           * `accessibilityState` is what native reads, and `aria-checked` is what ends up in the
           * DOM - React Native Web does not translate the first into the second on a `Pressable`,
           * so the rendered page had five radios and nothing saying which was on. And it is
           * `checked` rather than `selected` in both: a radio's state is checked, `selected`
           * belongs to options and tabs, and `aria-selected` is invalid on `role="radio"` so it
           * rendered as nothing even where it was emitted.
           *
           * None of this was visible to the component test, which reads `accessibilityState`
           * directly and passed throughout. It took looking at the DOM.
           */
          accessibilityState={{ checked: on, disabled: !!o.disabled }}
          aria-checked={on}
          aria-disabled={!!o.disabled}
          accessibilityLabel={o.hint ? `${o.label}. ${o.hint}` : o.label}
          disabled={o.disabled}
          style={({ pressed }) => [
            styles.chip,
            fill && styles.chipFill,
            stacked && styles.chipStacked,
            on && styles.chipOn,
            o.disabled && styles.chipOff,
            // A press state, because a chip that does nothing visible until the state lands reads
            // as unresponsive on a slow phone.
            pressed && !o.disabled && styles.chipPressed,
          ]}
        >
          {o.icon ? (
            <Ionicons
              name={o.icon}
              size={16}
              color={on ? palette.textOnPrimary : o.disabled ? palette.iconFaint : palette.primaryDeep}
            />
          ) : null}
          <View style={stacked ? styles.stackedText : undefined}>
            <Text
              variant="caption"
              weight="semibold"
              style={on ? styles.onText : o.disabled ? styles.offText : undefined}
            >
              {o.label}
            </Text>
            {o.hint ? (
              <Text variant="micro" style={on ? styles.onHint : styles.offHint}>
                {o.hint}
              </Text>
            ) : null}
          </View>
          {stacked ? (
            <Ionicons
              name={on ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={on ? palette.textOnPrimary : palette.iconFaint}
            />
          ) : null}
        </Pressable>
      </View>
    );
  });

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[stacked ? styles.stacked : styles.row, style]}
    >
      {!stacked && scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollInner}>
          {chips}
        </ScrollView>
      ) : (
        chips
      )}
    </View>
  );
}

interface MultiProps<T extends string> {
  options: readonly SegmentOption<T>[];
  /** Everything currently on. The caller owns the array. */
  value: readonly T[];
  onToggle: (value: T) => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The same chips, for choosing *several*.
 *
 * Separate from `SegmentedControl` rather than a `multi` prop on it, because the difference that
 * matters is the accessibility role and it has to be unambiguous. Picking skills is a set of
 * independent checkboxes; picking a refund outcome is a radio group where choosing one unpicks
 * another. Both were `accessibilityRole="button"` before this, which told a screen reader nothing
 * about either - somebody working through a provider's skill list had no way to know which of
 * fourteen chips were already on.
 */
export function ChipMultiSelect<T extends string>({ options, value, onToggle, label, style }: MultiProps<T>) {
  return (
    <View accessibilityLabel={label} style={[styles.row, style]}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => !o.disabled && onToggle(o.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: !!o.disabled }}
            // Same reason as the radio above: native reads the state object, the DOM needs the
            // ARIA attribute, and neither is derived from the other.
            aria-checked={on}
            aria-disabled={!!o.disabled}
            accessibilityLabel={o.label}
            disabled={o.disabled}
            style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !o.disabled && styles.chipPressed]}
          >
            {/* The tick is what makes a multi-select read as a checkbox at a glance, rather than as a
                row of buttons where one happens to be a different colour. */}
            {on ? <Ionicons name="checkmark" size={14} color={palette.textOnPrimary} /> : null}
            <Text variant="caption" weight="semibold" style={on ? styles.onText : undefined}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scrollInner: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
  stacked: { gap: spacing.sm },
  stackedItem: { width: '100%' },
  fillItem: { flex: 1 },
  // Centred and with the padding down, because an equal share of a narrow row is not much room.
  chipFill: { paddingHorizontal: spacing.sm, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    // The accessible minimum, which three of the eight hand-rolled versions missed.
    minHeight: layout.touchTarget - 4,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chipStacked: { borderRadius: radius.md, paddingVertical: spacing.md, minHeight: layout.touchTarget + 8 },
  chipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipOff: { backgroundColor: palette.surfaceMuted, borderColor: palette.borderSoft },
  chipPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  stackedText: { flex: 1, gap: 1 },
  onText: { color: palette.textOnPrimary },
  offText: { color: palette.textMuted },
  onHint: { color: palette.textOnPrimaryMuted },
  offHint: { color: palette.textMuted },
});
