import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { layout, palette, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  prefix?: string;
  pill?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, icon, prefix, pill, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? palette.danger : focused ? palette.primary : 'transparent';
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
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          accessibilityLabel={label ?? rest.placeholder}
          {...rest}
          style={[styles.input, style]}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="danger" style={styles.helper}>
          {error}
        </Text>
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
});
