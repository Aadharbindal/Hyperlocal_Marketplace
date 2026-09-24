import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { layout, palette, spacing } from '@/theme';
import { useNetwork } from '@/store/network';
import { useStrings } from '@/i18n';
import { OfflineBanner } from './states';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Leave room for the floating tab bar. */
  withTabBar?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: ViewStyle;
  keyboard?: boolean;
}

/** Mint-ground screen shell with safe areas, offline banner and optional scroll/refresh. */
export function Screen({ children, scroll = true, padded = true, withTabBar, refreshing, onRefresh, style, keyboard }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const online = useNetwork((s) => s.online);
  const t = useStrings();
  const bottomPad = withTabBar ? layout.tabBarHeight + layout.tabBarMargin * 2 : insets.bottom + spacing.lg;
  const content = (
    <View style={[styles.content, padded && styles.padded, { paddingBottom: bottomPad }, style]}>{children}</View>
  );
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.grow}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={palette.primary} colors={[palette.primary]} /> : undefined}
    >
      {content}
    </ScrollView>
  ) : (
    content
  );
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* No backgroundColor: Android is edge-to-edge from SDK 57, so the bar is transparent and
          the ground colour on the view below shows through it. */}
      <StatusBar style="dark" />
      <OfflineBanner visible={!online} label={t('error.OFFLINE')} />
      {keyboard ? (
        <KeyboardAvoidingView style={styles.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ground },
  grow: { flexGrow: 1 },
  content: { flexGrow: 1, paddingTop: spacing.md },
  padded: { paddingHorizontal: spacing.screen },
});
