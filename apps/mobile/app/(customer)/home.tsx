import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import HERO_HOUSE from '../../assets/hero-house.png';
import { useCategories } from '@/api/hooks';
import { useNotifications } from '@/api/reach';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { layout, palette, radius, spacing } from '@/theme';
import { BookAgain } from '@/features/customer/BookAgain';
import { HomeHeader } from '@/features/customer/HomeHeader';
import { PriceGuideLine } from '@/features/customer/PriceGuideLine';
import { Button, Card, Dots, IconButton, Screen, SectionHeader, Skeleton, Spacer, Text, TextField, ErrorState, RealisticIcon, OfferIllustration } from '@/ui';

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
  // The last line is the one that gets the mint; everything before it stays white.
  const heroTitleLines = t('home.hero.title').split('\n');

  return (
    <Screen withTabBar refreshing={categories.isRefetching} onRefresh={() => void categories.refetch()}>
      <HomeHeader
        greeting={t(greetingKey())}
        name={firstName || 'Welcome'}
        city={t('home.city')}
        unread={notifications.data?.unread ?? 0}
        onNotifications={() => router.push('/notifications')}
        onChangeCity={comingSoon}
      />

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
          {/* The brand chip from the reference banner. Small, quiet, and the only place the
              product names itself on this screen. */}
          <View style={styles.heroBadge} importantForAccessibility="no-hide-descendants">
            <View style={styles.heroBadgeIcon}>
              <Ionicons name="home" size={11} color={palette.textOnPrimary} />
            </View>
            <Text variant="micro" weight="semibold" tone="onPrimary">
              {t('home.hero.badge')}
            </Text>
          </View>

          {/* Two-tone, as in the reference: the what in white, the promise in mint. Split on the
              line break the translation already carries, so Hindi gets the same treatment
              without a second pair of strings to keep in step. */}
          <Text variant="title" weight="extrabold" tone="onPrimary" style={styles.heroTitle}>
            {heroTitleLines.slice(0, -1).join('\n')}
            {heroTitleLines.length > 1 ? '\n' : ''}
            <Text variant="title" weight="extrabold" style={styles.heroTitleAccent}>
              {heroTitleLines[heroTitleLines.length - 1]}
            </Text>
          </Text>

          <Text variant="caption" tone="onPrimaryMuted" style={styles.heroSubtitle}>
            {t('home.hero.subtitle')}
          </Text>
          <Button title={t('home.hero.cta')} variant="onPrimary" size="sm" iconRight="arrow-forward" style={styles.heroCta} onPress={() => book()} />
        </View>

        {/* Decorative: the house says nothing the headline does not already say, so a screen
            reader is spared it. */}
        <Image
          source={HERO_HOUSE}
          style={styles.heroArt}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </LinearGradient>
      <Dots count={4} active={0} />

      {/* Categories */}
      <Spacer h={spacing.xxl} />
      {/* Before the category grid on purpose: somebody who has been here before should not have
          to scroll past the beginner's path to reach the one that is already theirs. */}
      <BookAgain />
      <Spacer h={spacing.md} />

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
                {/* One line that shrinks rather than two that break a word in half:
                    "Carpentry" was splitting into "Carpentr / y". */}
                <Text
                  variant="label"
                  weight="medium"
                  center
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={styles.tileLabel}
                >
                  {c.name}
                </Text>
                {/* The question a tile is really being asked is "could I afford to find out?" */}
                <PriceGuideLine guide={c.priceGuide} />
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  searchField: { flex: 1 },
  // The reference banner is landscape; a phone is not. The composition is kept - words left,
  // house right - and the card is allowed to be taller so neither has to be squeezed.
  hero: {
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingLeft: spacing.xl,
    paddingRight: 0,
    minHeight: 232,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  // `minWidth: 0` for the same reason as the header: a flex child will not otherwise shrink
  // below its content, and that is how a headline ends up broken across the wrong words.
  heroText: { flex: 1, minWidth: 0, gap: spacing.xs, justifyContent: 'center' },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: 8,
    paddingLeft: 4,
    borderRadius: radius.pill,
    // A 5% wash rather than the reference's heavier one: at 16% the green lightens enough
    // that the 11px white label drops under AA. The hairline gives the pill its shape back
    // without touching the fill.
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    marginBottom: spacing.xs,
  },
  heroBadgeIcon: {
    width: 20,
    height: 20,
    borderRadius: 7,
    backgroundColor: palette.heroAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sized so the headline lands on the two lines the copy is written for. At the default
  // title size the column left over beside the illustration forced it onto four, which
  // breaks the phrase in the wrong places.
  heroTitle: { fontSize: 22, lineHeight: 27, letterSpacing: -0.4 },
  heroTitleAccent: { color: palette.heroTitleAccent },
  heroSubtitle: { marginTop: 2 },
  heroCta: { marginTop: spacing.md },
  // Bleeds to the card's right edge, as it does in the reference, rather than sitting in a
  // padded box with the gradient showing around it.
  heroArt: { width: 132, height: 172, marginRight: -4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '22.5%', flexGrow: 1, alignItems: 'center', gap: spacing.sm, minHeight: 124 },
  tileLabel: { minHeight: 20, width: '100%' },
  tileSkeletonLabel: { marginTop: spacing.xs },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderRadius: radius.xl },
  offerText: { flex: 1, gap: 2 },
  offerChevron: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  notice: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md },
});
