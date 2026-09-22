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
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
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
        <View style={styles.row}>
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
