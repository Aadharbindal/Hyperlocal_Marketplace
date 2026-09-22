import { Pressable, StyleSheet, View, type PressableProps, type ViewProps, type ViewStyle } from 'react-native';
import { elevation, palette, radius, spacing } from '@/theme';

interface CardProps extends ViewProps {
  tone?: 'surface' | 'soft' | 'muted';
  padding?: keyof typeof spacing | 0;
  flat?: boolean;
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
}

const BG = { surface: palette.surface, soft: palette.groundDeep, muted: palette.surfaceMuted } as const;

/** White rounded container with the soft teal shadow from the reference design. */
export function Card({ tone = 'surface', padding = 'lg', flat, onPress, style, children, accessibilityLabel, ...rest }: CardProps) {
  const base: ViewStyle[] = [
    styles.card,
    { backgroundColor: BG[tone], padding: padding === 0 ? 0 : spacing[padding] },
    !flat && tone === 'surface' ? elevation.card : {},
  ];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && styles.pressed, style as ViewStyle]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View {...rest} style={[...base, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
});
