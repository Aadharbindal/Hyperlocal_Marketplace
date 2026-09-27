import { StyleSheet, View } from 'react-native';
import { formatInrRange, type PriceGuide } from '@hyperlocal/core';
import { palette, spacing } from '@/theme';
import { Text } from '@/ui';

/**
 * Roughly what this costs, said before anybody has quoted.
 *
 * Until this existed a customer described a leaking tap, pressed submit and waited, with no idea
 * whether the answer would be three hundred rupees or three thousand. That is a lot to ask of
 * somebody who has never used the service, and it is where most of them stopped.
 *
 * Two rules about how it is worded, because a price guide that overpromises is worse than none.
 *
 * It never says "₹300" - it is always a range, because a range is what we actually know. And it
 * distinguishes a measurement from a guess: once enough people have paid for this kind of work
 * it says so and how many, and until then it says "usually", which is a weaker word on purpose.
 */
export function PriceGuideLine({ guide, size = 'micro' }: { guide: PriceGuide | null; size?: 'micro' | 'caption' }) {
  if (!guide) return null;

  const measured = guide.basis === 'ACTUAL';
  return (
    <View style={styles.row}>
      <Text variant={size} weight="semibold" style={{ color: palette.primaryDeep }}>
        {formatInrRange(guide.minPaise, guide.maxPaise)}
      </Text>
      <Text variant="micro" tone="muted">
        {measured ? `what ${guide.sampleSize} people paid` : 'usually'}
      </Text>
    </View>
  );
}

/**
 * The same thing with room to be explicit, for the booking screen where somebody is deciding
 * rather than browsing. Labour is named because materials are bought at a shop's price and
 * quoted separately - an estimate that quietly excluded them would be wrong in the direction
 * that annoys people most.
 */
export function PriceGuideNote({ guide }: { guide: PriceGuide | null }) {
  if (!guide) return null;

  return (
    <View style={styles.note}>
      <Text variant="caption" weight="semibold" style={{ color: palette.primaryDeep }}>
        {formatInrRange(guide.minPaise, guide.maxPaise)}
        <Text variant="caption" tone="secondary" weight="regular">
          {guide.basis === 'ACTUAL' ? `  ·  what ${guide.sampleSize} people paid for this` : '  ·  typical for this work'}
        </Text>
      </Text>
      <Text variant="micro" tone="muted">
        Labour only. Any parts are bought at the shop&apos;s price and shown separately. Your final
        price comes from the professional after they have seen the job.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  note: { gap: 2 },
});
