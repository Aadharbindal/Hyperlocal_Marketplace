import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import type { FieldProblem } from '@hyperlocal/core';
import { layout, palette, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Sits before the value and is not part of it: `+91`, `₹`. */
  prefix?: string;
  /** Sits after it, for a unit the person should not have to type: `km`, `min`, `/ unit`. */
  suffix?: string;
  pill?: boolean;
  /**
   * Marks the field as one the form will not submit without.
   *
   * A word, not an asterisk. An asterisk is a convention people have to already know, and a screen
   * reader announces it as "star".
   */
  required?: boolean;
  /**
   * How many lines a multiline field opens at. Ignored unless `multiline` is set.
   *
   * Three is the default because it is tall enough to read back what you wrote - a two-line box
   * that scrolls while you are still in your first sentence is the reason people give up on them.
   */
  minLines?: number;
  /**
   * Show "120 / 300" under a length-capped field.
   *
   * Only worth it where somebody is writing prose and could genuinely run out. A counter under a
   * six-digit PIN is noise, so this is opt-in rather than automatic from `maxLength`.
   */
  counter?: boolean;
  /**
   * The same check the server will run, so the person hears about a problem while their hands
   * are still on the keyboard rather than after a round trip - and hears the *same sentence*
   * either way, because both sides call this function.
   *
   * Run on blur, never while typing: complaining about an email at "r@" is pedantry, and an
   * error that appears and vanishes as somebody types is noise they learn to ignore.
   */
  validate?: (value: string) => FieldProblem | null;
  /** Called when the person accepts a suggested correction, e.g. a mistyped email domain. */
  onAcceptSuggestion?: (value: string) => void;
}

/**
 * Every text input in the app.
 *
 * It is worth saying why that matters, because for most of this project it was not true: nineteen
 * screens had their own `<TextInput>` with their own border radius, their own padding and their own
 * placeholder colour, and the result was a product where no two forms looked alike and four of them
 * had hand-rolled their own copy of the validation UI. Two concrete bugs came out of that drift,
 * and both were in *every* one of those screens at once:
 *
 * - the placeholder was `#A9B8B1`, which is **2.06:1** on white. A placeholder is frequently the
 *   only example of what a field wants, so it is content, and 2:1 is not readable content.
 * - the input text had no `fontFamily`, so while every label and heading in the app is Poppins,
 *   everything anybody *typed* came out in the system font. Nothing failed; it just quietly looked
 *   like two apps stitched together.
 *
 * Both are fixed here once. `scripts/a11y-audit.mjs` now reads `placeholderTextColor=` as well as
 * `color:`, so the first one cannot come back without the audit saying so.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    helper,
    error,
    icon,
    prefix,
    suffix,
    pill,
    required,
    minLines = 3,
    counter,
    style,
    validate,
    onAcceptSuggestion,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<FieldProblem | null>(null);
  // A problem the caller passes in wins: it usually came from the server, which knows things the
  // client cannot - that an email is already on another account, say.
  const problem = error ?? found?.message ?? null;
  const value = typeof rest.value === 'string' ? rest.value : '';
  const multiline = !!rest.multiline;

  return (
    <View style={styles.wrap}>
      {label ? (
        <View style={styles.labelRow}>
          <Text variant="label" tone="secondary" style={styles.label}>
            {label}
          </Text>
          {required ? (
            <Text variant="micro" tone="muted">
              required
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          pill && styles.pill,
          // A focus ring rather than only a colour change. On a mint ground a 1.5px teal border is
          // easy to miss, and the halo is what tells somebody mid-form which box they are in.
          focused && styles.focused,
          problem ? styles.bad : focused ? styles.focusedBorder : styles.idle,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color={problem ? palette.danger : focused ? palette.primary : palette.textMuted}
            style={multiline ? styles.iconTop : undefined}
          />
        ) : null}
        {prefix ? (
          <Text variant="body" weight="semibold" tone="secondary">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={palette.inputPlaceholder}
          onFocus={(e) => {
            setFocused(true);
            // Clear on focus: somebody who has come back to fix it should not be shouted at
            // while they do.
            setFound(null);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            // An empty optional field is not a problem; whether it is required is the form's
            // business, not this component's.
            setFound(validate && value.trim() ? validate(value) : null);
            onBlur?.(e);
          }}
          accessibilityLabel={label ?? rest.placeholder}
          // Announced together, so a screen reader reaching a field in error says what is wrong
          // instead of leaving somebody to find the sentence underneath it.
          accessibilityHint={problem ?? helper}
          {...rest}
          style={[
            styles.input,
            multiline && { minHeight: minLines * typography.lineHeight.body, textAlignVertical: 'top' },
            style,
          ]}
        />
        {suffix ? (
          <Text variant="caption" tone="muted">
            {suffix}
          </Text>
        ) : null}
      </View>

      <View style={styles.underRow}>
        <View style={styles.underText}>
          {problem ? (
            found?.suggestion && onAcceptSuggestion ? (
              /* A correction is offered, never applied. Silently fixing an address is how a receipt
                 goes to a stranger. */
              <Pressable
                onPress={() => {
                  onAcceptSuggestion(found.suggestion!);
                  setFound(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use ${found.suggestion}`}
                style={styles.suggestion}
              >
                <Ionicons name="arrow-forward-circle" size={15} color={palette.primaryDeep} />
                <Text variant="caption" weight="semibold" tone="primary">
                  {problem}
                </Text>
              </Pressable>
            ) : (
              <Text variant="caption" tone="danger" style={styles.helper} accessibilityLiveRegion="polite">
                {problem}
              </Text>
            )
          ) : helper ? (
            <Text variant="caption" tone="muted" style={styles.helper}>
              {helper}
            </Text>
          ) : null}
        </View>
        {counter && rest.maxLength ? (
          /* Only once there is something to count down from. A "0 / 300" under an empty box reads
             as a requirement rather than a limit. */
          <Text variant="micro" tone={value.length >= rest.maxLength ? 'danger' : 'muted'}>
            {value.length > 0 ? `${value.length} / ${rest.maxLength}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { marginLeft: spacing.xs },
  field: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceMuted,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
  },
  fieldMultiline: { alignItems: 'flex-start', paddingVertical: spacing.md, minHeight: 0 },
  iconTop: { marginTop: 2 },
  idle: { borderColor: 'transparent' },
  focusedBorder: { borderColor: palette.primary },
  bad: { borderColor: palette.danger },
  focused: {
    shadowColor: palette.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  pill: { borderRadius: radius.pill, minHeight: layout.touchTarget + 4 },
  input: {
    flex: 1,
    // The line that was missing. Without it everything anybody types renders in the system font
    // while every label around it is Poppins.
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    color: palette.text,
    paddingVertical: spacing.md,
  },
  underRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minHeight: 0 },
  underText: { flex: 1 },
  helper: { marginLeft: spacing.xs },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.xs, minHeight: 32 },
});
