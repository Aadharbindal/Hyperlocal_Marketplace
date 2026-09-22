import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { palette, radius, spacing } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';
import { IconChip } from './primitives';

/** Loading placeholder block with a gentle shimmer. */
export function Skeleton({ width = '100%', height = 16, round, style }: { width?: number | `${number}%`; height?: number; round?: boolean; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View accessibilityLabel="Loading" style={[{ width, height, borderRadius: round ? height / 2 : radius.sm, backgroundColor: palette.border, opacity }, style]} />;
}

export function EmptyState({ icon = 'leaf-outline', title, body, actionLabel, onAction }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.center} accessibilityRole="summary">
      <IconChip icon={icon} bg={palette.primarySoft} fg={palette.primary} size={72} />
      <Text variant="heading" center style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" center>
          {body}
        </Text>
      ) : null}
      {actionLabel ? <Button title={actionLabel} onPress={onAction} size="md" style={styles.action} /> : null}
    </View>
  );
}

export function ErrorState({ title, body, onRetry, retrying }: { title: string; body?: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <IconChip icon="alert-circle-outline" bg={palette.dangerSoft} fg={palette.danger} size={72} />
      <Text variant="heading" center style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" center>
          {body}
        </Text>
      ) : null}
      {onRetry ? <Button title="Try again" variant="secondary" size="md" onPress={onRetry} loading={retrying} style={styles.action} /> : null}
    </View>
  );
}

export function OfflineBanner({ visible, label }: { visible: boolean; label: string }) {
  if (!visible) return null;
  return (
    <View style={styles.offline} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color={palette.textOnPrimary} />
      <Text variant="caption" weight="semibold" tone="onPrimary">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: spacing.huge, paddingHorizontal: spacing.xxl, gap: spacing.sm },
  title: { marginTop: spacing.sm },
  action: { marginTop: spacing.md },
  offline: { backgroundColor: palette.textSecondary, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
