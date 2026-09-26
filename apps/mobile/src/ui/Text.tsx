import { Text as RNText, StyleSheet, type TextProps as RNTextProps } from 'react-native';
import { palette, typography } from '@/theme';

type Variant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption' | 'micro';
type Tone = 'default' | 'secondary' | 'muted' | 'primary' | 'onPrimary' | 'onPrimaryMuted' | 'danger' | 'success';
type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: Weight;
  center?: boolean;
}

const TONE: Record<Tone, string> = {
  default: palette.text,
  secondary: palette.textSecondary,
  muted: palette.textMuted,
  // Teal text, not the teal fill. The brand teal carries white on top of it at AA, but read as
  // ink on a light ground it lands around 4:1 - under the line, and this is the tone links and
  // prices use. `primaryDeep` is the same hue with the contrast, so nothing looks off-brand.
  primary: palette.primaryDeep,
  onPrimary: palette.textOnPrimary,
  onPrimaryMuted: palette.textOnPrimaryMuted,
  danger: palette.danger,
  success: palette.success,
};

const DEFAULT_WEIGHT: Record<Variant, Weight> = {
  display: 'bold',
  title: 'bold',
  heading: 'bold',
  subheading: 'semibold',
  body: 'regular',
  label: 'medium',
  caption: 'regular',
  micro: 'medium',
};

export function Text({ variant = 'body', tone = 'default', weight, center, style, ...rest }: TextProps) {
  const w = weight ?? DEFAULT_WEIGHT[variant];
  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        {
          fontSize: typography.size[variant],
          lineHeight: typography.lineHeight[variant],
          fontFamily: typography.family[w],
          color: TONE[tone],
          textAlign: center ? 'center' : undefined,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ base: { includeFontPadding: false } });
