import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';
import { layout, palette, radius, spacing } from '@/theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onPrimary';
type Size = 'lg' | 'md' | 'sm';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  style?: ViewStyle;
}

const BG: Record<Variant, string> = {
  primary: palette.primary,
  secondary: palette.primarySoft,
  ghost: 'transparent',
  danger: palette.dangerSoft,
  onPrimary: palette.surface,
};
const BG_PRESSED: Record<Variant, string> = {
  primary: palette.primaryPressed,
  secondary: '#C6E8DA',
  ghost: palette.surfaceMuted,
  danger: '#F9C8CA',
  onPrimary: '#EAF7F1',
};
const FG: Record<Variant, string> = {
  primary: palette.textOnPrimary,
  secondary: palette.primaryDeep,
  ghost: palette.primary,
  danger: palette.danger,
  onPrimary: palette.primaryDeep,
};
const HEIGHT: Record<Size, number> = { lg: 56, md: layout.touchTarget, sm: 40 };

export function Button({ title, variant = 'primary', size = 'lg', loading, icon, iconRight, fullWidth, disabled, style, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      // Named explicitly rather than letting the platform build a name out of the children: with
      // an icon beside the label that produced "Find providers," - a trailing comma a screen
      // reader renders as a pause - and announced the label twice.
      accessible
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      /* `busy` is the whole point of the loading state for somebody who cannot see the spinner,
         and React Native Web does not turn the state object into ARIA - so every submitting
         button in the app was silent about it. `disabled` does reach the DOM through the prop
         below, but a natively disabled button is also removed from the tab order, and
         `aria-disabled` is what keeps it announceable while it is refusing. */
      aria-busy={!!loading}
      aria-disabled={!!isDisabled}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], backgroundColor: pressed ? BG_PRESSED[variant] : BG[variant], opacity: isDisabled ? 0.55 : 1 },
        fullWidth && styles.full,
        size === 'sm' && styles.sm,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={FG[variant]} />
      ) : (
        // The label is on the Pressable; the same words inside it would be read a second
        // time. `accessible` alone does not collapse children on Android.
        <View style={styles.row} importantForAccessibility="no-hide-descendants">
          {icon ? <Ionicons name={icon} size={18} color={FG[variant]} /> : null}
          <Text variant={size === 'sm' ? 'label' : 'subheading'} weight="semibold" style={{ color: FG[variant] }}>
            {title}
          </Text>
          {iconRight ? <Ionicons name={iconRight} size={18} color={FG[variant]} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  sm: { paddingHorizontal: spacing.lg },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
