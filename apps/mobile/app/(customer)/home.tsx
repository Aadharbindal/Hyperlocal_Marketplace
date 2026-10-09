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
import { Button, Card, IconButton, Screen, SectionHeader, Skeleton, Spacer, Text, TextField, ErrorState, RealisticIcon, OfferIllustration } from '@/ui';

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

          {/* Two-tone, as in the reference: the what in white, the promise in mint.
              Rendered as one Text per line, each allowed to shrink, rather than one Text with a
              newline in it. Guessing whether a phrase fits the column left beside the artwork is
              how it ended up broken across four lines twice; this way the copy decides how many
              lines there are and the type gives way if it has to - in Hindi as well. */}
          {/* One fixed size for both lines. They used to auto-shrink, and because each line
              shrinks on its own the longer one came out visibly smaller than the other - the
              two halves of one phrase set at two different sizes.

              The size is 21, and the previous 23 was arrived at from a measurement that was simply
              wrong: the comment here claimed a 189pt column and a 179pt line, and the column is
              **167.3pt** on a 375pt screen while "Home Services" renders at 176. So the headline on
              the first screen of the app read "Home Servic..." - caught by looking at it rather
              than by any test, which is the argument for looking at it. Measured in the running app
              at 375pt: 21px puts the widest line at 161pt with six to spare, and Hindi is far
              narrower (113pt), so English is what this is sized against. */}
          <View style={styles.heroTitleBlock}>
            {heroTitleLines.map((line, i) => (
              <Text
                key={line}
                variant="title"
                weight="extrabold"
                numberOfLines={1}
                // A safety net for a narrower phone or a large system font, not a layout tool. At
                // 375pt neither line shrinks, so the two halves of the phrase stay the same size;
                // the floor covers down to about a 340pt screen, which is below anything this app
                // supports. It does nothing on web - `adjustsFontSizeToFit` is not implemented
                // there - which is why the base size has to fit on its own rather than relying on
                // this to rescue it.
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                tone={i === heroTitleLines.length - 1 ? 'default' : 'onPrimary'}
                style={[styles.heroTitle, i === heroTitleLines.length - 1 && styles.heroTitleAccent]}
              >
                {line}
              </Text>
            ))}
          </View>

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
      {/* The pagination dots that used to sit here said `count={4} active={0}` under a single
          hero that does not scroll. They promised three more panels to swipe to and swiping did
          nothing - a control describing an interface the app does not have. Building the carousel
          would mean inventing three more hero messages, which is product copy rather than a
          design fix, so the dots go and the hero keeps the room. */}

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
              <Card key={c.id} style={styles.tile} padding="sm" onPress={() => book(c.id)} accessibilityLabel={c.name}>
                <RealisticIcon iconKey={c.iconKey} size={56} />
                {/* "Carpentry" came out as "Carpent..." - measured in the running app at 78.0pt
                    inside a 78.4pt box, which is no margin at all, and the `adjustsFontSizeToFit`
                    meant to rescue it does nothing on web and only shrinks the type on native.
                    The tile's own padding was the problem rather than the type size: `sm` instead
                    of `md` returns nine points to the label, which is enough for the longest trade
                    name here.

                    Two lines are allowed again now that a single word fits on one. The reason they
                    were banned - "Carpentry" splitting into "Carpentr / y" - was a symptom of the
                    word not fitting at all; with room for it, wrapping only ever happens at a space,
                    which is what a two-word trade like "Appliance repair" needs. */}
                <Text
                  variant="label"
                  weight="medium"
                  center
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
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
  // The reference banner is 1.9:1; a phone card is about 1.3:1. Side by side, a house that big
  // and a headline that big cannot both have the room they have there - so the art is taken out
  // of the flex row and positioned, which lets it be the size it is in the reference while the
  // words sit over the part of it that is only clouds and dotted arc. The house itself stays
  // clear on the right, where it belongs.
  hero: {
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingLeft: spacing.xl,
    paddingRight: spacing.lg,
    minHeight: 236,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // `minWidth: 0` for the same reason as the header: a flex child will not otherwise shrink
  // below its content, and that is how a headline ends up broken across the wrong words.
  // Clear of the art entirely. An earlier version let the text run under what I assumed was
  // empty space on the illustration's left - measuring it showed the artwork fills its whole
  // width, so a cloud landed on "Made Simple" and the house sat over the button.
  heroText: { minWidth: 0, gap: spacing.xs, justifyContent: 'center', paddingRight: 132 },
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
  // Smaller than the reference's headline relative to the card, and deliberately.
  //
  // That banner is 1.9:1 and this card is about 1.3:1, so its split - a little under half to
  // the words, a little over half to the artwork - only survives on a phone if the type gives
  // way. Keeping the headline large instead would mean shrinking the house to a thumbnail,
  // and the house is the thing the banner is actually about.
  // Two lines of one phrase, so they are set tight - the line box is barely taller than the
  // letters and there is no gap between them.
  heroTitleBlock: { marginVertical: 2 },
  heroTitle: { fontSize: 21, lineHeight: 25, letterSpacing: -0.5, width: '100%' },
  heroTitleAccent: { color: palette.heroTitleAccent },
  heroSubtitle: { marginTop: 2 },
  heroCta: { marginTop: spacing.md },
  // The asset carries only about three points of its own transparent margin, so the gap has to
  // come from the card rather than from the picture.
  // An explicit box in the artwork's own proportions, centred by hand.
  //
  // It used to be `top: 0, bottom: 0` with `contain` left to work the rest out. That reads as
  // "fit it in the card", and it does not: the height came from the card, the scale came from
  // the width, and the illustration ended up low and clipped by the bottom edge. Giving the box
  // the aspect ratio the file actually has takes the guesswork out - there is nothing left for
  // `contain` to decide.
  heroArt: {
    position: 'absolute',
    // Just inside the card. Any further out and the broom chip clips against the edge, which
    // reads as a mistake rather than as the artwork sitting close to the border.
    right: 8,
    width: 130,
    height: 102,
    top: '50%',
    // Centred, then nudged down. The artwork's top half is clouds and a chip while its
    // bottom is the house and its shadow, so true centring leaves it sitting visually high.
    marginTop: -33,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '22.5%', flexGrow: 1, alignItems: 'center', gap: spacing.sm, minHeight: 124 },
  // Natural height, not two lines' worth reserved. Reserving it kept the price lines level and
  // left a visible hole under every short name; the row stretches its tiles to the tallest on its
  // own, so a name that does wrap lifts the whole row rather than punching a gap in each tile.
  tileLabel: { minHeight: 20, width: '100%' },
  tileSkeletonLabel: { marginTop: spacing.xs },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderRadius: radius.xl },
  offerText: { flex: 1, gap: 2 },
  offerChevron: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  notice: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.primarySoft, borderRadius: radius.md, padding: spacing.md },
});
