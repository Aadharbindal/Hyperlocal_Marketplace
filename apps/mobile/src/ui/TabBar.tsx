import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, layout, palette, radius, spacing } from '@/theme';
import { Text } from './Text';

/**
 * expo-router 57 vendors react-navigation rather than depending on it, so
 * `@react-navigation/bottom-tabs` is no longer a package we can import from. The type is derived
 * from the `tabBar` prop of the `Tabs` component we already use - which is public API, and will
 * keep pointing at the right shape through the next upgrade too.
 */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

export interface TabSpec {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  badge?: boolean;
}

/** Floating white pill tab bar with active teal item + underline dot (reference design). */
export function FloatingTabBar({ state, navigation, specs }: BottomTabBarProps & { specs: TabSpec[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, layout.tabBarMargin) }]}>
      <View style={[styles.bar, elevation.floating]} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const spec = specs.find((s) => s.name === route.name);
          if (!spec) return null;
          const active = state.index === index;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!active && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={spec.label} onPress={onPress} style={styles.item}>
              <View>
                <Ionicons name={active ? spec.iconActive : spec.icon} size={24} color={active ? palette.primary : palette.textSecondary} />
                {spec.badge ? <View style={styles.badge} /> : null}
              </View>
              <Text variant="micro" weight={active ? 'bold' : 'medium'} style={{ color: active ? palette.primary : palette.textSecondary }}>
                {spec.label}
              </Text>
              <View style={[styles.dot, { opacity: active ? 1 : 0 }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: layout.tabBarMargin, right: layout.tabBarMargin },
  bar: {
    height: layout.tabBarHeight,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: layout.touchTarget },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.primary, marginTop: 1 },
  badge: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: palette.danger, borderWidth: 1.5, borderColor: palette.surface },
});
