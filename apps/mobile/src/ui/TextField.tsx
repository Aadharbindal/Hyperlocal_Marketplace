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
  prefix?: string;
  pill?: boolean;
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

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, icon, prefix, pill, style, validate, onAcceptSuggestion, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<FieldProblem | null>(null);
  // A problem the caller passes in wins: it usually came from the server, which knows things the
  // client cannot - that an email is already on another account, say.
  const problem = error ?? found?.message ?? null;
  const borderColor = problem ? palette.danger : focused ? palette.primary : 'transparent';
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" tone="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={[styles.field, pill && styles.pill, { borderColor }]}>
        {icon ? <Ionicons name={icon} size={20} color={focused ? palette.primary : palette.textMuted} /> : null}
        {prefix ? (
          <Text variant="body" weight="semibold" tone="secondary">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={palette.textMuted}
          onFocus={(e) => {
            setFocused(true);
            // Clear on focus: somebody who has come back to fix it should not be shouted at
            // while they do.
            setFound(null);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            const value = typeof rest.value === 'string' ? rest.value : '';
            // An empty optional field is not a problem; whether it is required is the form's
            // business, not this component's.
            setFound(validate && value.trim() ? validate(value) : null);
            onBlur?.(e);
          }}
          accessibilityLabel={label ?? rest.placeholder}
          {...rest}
          style={[styles.input, style]}
        />
      </View>
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
          <Text variant="caption" tone="danger" style={styles.helper}>
            {problem}
          </Text>
        )
      ) : helper ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
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
  pill: { borderRadius: radius.pill, minHeight: layout.touchTarget + 4 },
  input: {
    flex: 1,
    fontSize: typography.size.body,
    color: palette.text,
    paddingVertical: spacing.md,
  },
  helper: { marginLeft: spacing.xs },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.xs, minHeight: 32 },
});
