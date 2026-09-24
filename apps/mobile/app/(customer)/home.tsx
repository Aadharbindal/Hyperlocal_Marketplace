import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCategories } from '@/api/hooks';
import { useNotifications } from '@/api/reach';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { layout, palette, radius, spacing } from '@/theme';
import { Avatar, Button, Card, Dots, IconButton, Screen, SectionHeader, Skeleton, Spacer, Text, TextField, ErrorState, RealisticIcon, HomeHeroIllustration, OfferIllustration } from '@/ui';

function greetingKey(): 'greeting.morning' | 'greeting.afternoon' | 'greeting.evening' {
  const h = new Date().getHours();
  return h < 12 ? 'greeting.morning' : h < 17 ? 'greeting.afternoon' : 'greeting.evening';
}

export default function HomeScreen() {
  const t = useStrings();
  const user = useSession((s) => s.user);
  const categories = useCategories();
  const [notice, setNotice] = useState<string | null>(null);
  const firstName = user?.displayName?.split(' ')[0] ?? '';
  const router = useRouter();
  const comingSoon = () => setNotice(t('home.comingSoon'));
  // The dot is only worth showing when there is genuinely something unread; a permanent one
  // teaches people to ignore it.
  const notifications = useNotifications();
  const book = (categoryId?: string) => router.push({ pathname: '/(customer)/book', params: categoryId ? { categoryId } : {} });

  return (
    <Screen withTabBar refreshing={categories.isRefetching} onRefresh={() => void categories.refetch()}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.greeting}>
          <Text variant="subheading" weight="medium" tone="secondary">
            {t(greetingKey())}
          </Text>
          <Text variant="title">{firstName ? `${firstName}! 👋` : 'Welcome! 👋'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Change city" style={styles.location} onPress={comingSoon}>
          <Ionicons name="location" size={18} color={palette.primary} />
          <Text variant="label" weight="semibold">
            Delhi
          </Text>
          <Ionicons name="chevron-down" size={16} color={palette.textSecondary} />
        </Pressable>
        <IconButton
          icon="notifications-outline"
          tone="plain"
          badge={(notifications.data?.unread ?? 0) > 0}
          accessibilityLabel={
            (notifications.data?.unread ?? 0) > 0 ? `Updates, ${notifications.data?.unread} unread` : 'Updates'
          }
          onPress={() => router.push('/notifications')}
        />
        <Avatar name={user?.displayName} />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          {/* A read-only field that opens the real search screen: tapping into a box that then
              has to fetch feels slower than opening one that is already listening. */}
          <Pressable onPress={() => router.push('/search')} accessibilityRole="button" accessibilityLabel={t('home.search')}>
            <View pointerEvents="none">
              <TextField pill icon="search-outline" placeholder={t('home.search')} editable={false} />
            </View>
          </Pressable>
        </View>
        <IconButton icon="options-outline" tone="primary" size={layout.touchTarget + 4} accessibilityLabel="Filters" onPress={comingSoon} />
      </View>

      {/* Hero */}
      <Spacer h={spacing.xl} />
      <LinearGradient colors={[palette.gradientStart, palette.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroText}>
          <Text variant="title" tone="onPrimary" style={styles.heroTitle}>
            {t('home.hero.title')}
          </Text>
          <Text variant="label" tone="onPrimaryMuted">
            {t('home.hero.subtitle')}
          </Text>
          <Button title={t('home.hero.cta')} variant="onPrimary" size="md" iconRight="arrow-forward" style={styles.heroCta} onPress={() => book()} />
        </View>
        <View style={styles.heroArt} accessibilityElementsHidden>
          <HomeHeroIllustration />
        </View>
      </LinearGradient>
      <Dots count={4} active={0} />

      {/* Categories */}
      <Spacer h={spacing.xxl} />
      <SectionHeader title={t('home.categories')} actionLabel={t('home.viewAll')} onAction={() => book()} />
      {categories.isPending ? (
        <View style={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} style={styles.tile} padding="md">
              <Skeleton width={layout.iconChip} height={layout.iconChip} />
              <Skeleton width="70%" height={12} style={styles.tileSkeletonLabel} />
            </Card>
          ))}
        </View>
      ) : categories.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void categories.refetch()} retrying={categories.isRefetching} />
      ) : (
        <View style={styles.grid}>
          {categories.data.items.map((c) => {
            return (
              <Card key={c.id} style={styles.tile} padding="md" onPress={() => book(c.id)} accessibilityLabel={c.name}>
                <RealisticIcon iconKey={c.iconKey} size={56} />
                <Text variant="label" weight="medium" center numberOfLines={2} style={styles.tileLabel}>
                  {c.name}
                </Text>
              </Card>
            );
          })}
        </View>
      )}

      {/* Offer */}
      <Spacer h={spacing.xxl} />
      <Card tone="soft" flat style={styles.offer} onPress={comingSoon} accessibilityLabel={t('home.offer.title')}>
        <OfferIllustration size={64} />
        <View style={styles.offerText}>
          <Text variant="heading">{t('home.offer.title')}</Text>
          <Text variant="label" tone="secondary">
            {t('home.offer.body')}
          </Text>
        </View>
        <View style={styles.offerChevron}>
          <Ionicons name="chevron-forward" size={22} color={palette.primary} />
        </View>
      </Card>

      {notice ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Ionicons name="information-circle" size={18} color={palette.primaryDeep} />
          <Text variant="caption" weight="medium" style={{ color: palette.primaryDeep, flex: 1 }}>
            {notice}
          </Text>
          <Pressable onPress={() => setNotice(null)} hitSlop={8} accessibilityLabel="Dismiss">
            <Ionicons name="close" size={18} color={palette.primaryDeep} />
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greeting: { flex: 1 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, minHeight: layout.touchTarget },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  searchField: { flex: 1 },
  hero: { borderRadius: radius.xl, padding: spacing.xxl, minHeight: 200, flexDirection: 'row', overflow: 'hidden' },
  heroText: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  heroTitle: { marginBottom: 2 },
  heroCta: { marginTop: spacing.md },
  heroArt: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '22.5%', flexGrow: 1, alignItems: 'center', gap: spacing.sm, minHeight: 124 },
  tileLabel: { minHeight: 40 },
  tileSkeletonLabel: { marginTop: spacing.xs },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderRadius: radius.xl },
  offerText: { flex: 1, gap: 2 },
  offerChevron: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  notice: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md },
});
