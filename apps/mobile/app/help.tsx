import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useStrings } from '@/i18n';
import { palette, spacing } from '@/theme';
import { Card, Screen, Spacer, Text } from '@/ui';

/**
 * The questions people actually ask, answered here rather than in a support queue.
 *
 * Every answer is one this codebase can stand behind: the cancellation charge is the one in
 * `customerCancellationCharge`, the warranty window is the one the warranty module enforces, and
 * the identity-document line is the rule the API enforces rather than a reassurance. If any of
 * those change, this list is wrong and has to change with them.
 */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'What does a booking cost?',
    a: 'You see a price range before you book, and a firm quote from the professional before any work starts. Nothing is charged until you accept that quote.',
  },
  {
    q: 'What if I cancel?',
    a: 'Nothing to pay if you cancel before the professional sets off. Once they are on their way, the visit fee applies. After work has started, support settles it case by case.',
  },
  {
    q: 'Is the work guaranteed?',
    a: 'Yes. If the same problem comes back within the warranty period shown on your receipt, raise a claim from that booking and the professional has 48 hours to respond.',
  },
  {
    q: 'Who is coming to my home?',
    a: 'Their name, photo, rating and completed-job count are on the booking before they arrive. Identity documents are checked by our team and are never shared with anyone else.',
  },
  {
    q: 'How do I pay?',
    a: 'On the app after the work is done, or in cash to the professional. Your receipt is in Profile, under Receipts, either way.',
  },
];

export default function HelpScreen() {
  const t = useStrings();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          {t('help.title')}
        </Text>
      </View>
      <Spacer h={spacing.xl} />

      {/* A way to reach a person, first. Burying it under the FAQ is how you turn somebody with a
          real problem into somebody with a real problem and a grievance. */}
      <Card
        style={styles.contact}
        // Was a `mailto:` to `support@hyperlocal.example` - a reserved TLD that cannot receive
        // mail, opened on a phone that may have no mail client configured. The ticket flow it goes
        // to now has existed in the API the whole time.
        onPress={() => router.push('/support')}
        accessibilityLabel={`${t('help.contact')}. ${t('help.contact.hint')}`}
      >
        <View style={styles.contactIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={palette.chip.blue.fg} />
        </View>
        <View style={styles.contactText}>
          <Text variant="label" weight="semibold">
            {t('help.contact')}
          </Text>
          <Text variant="micro" tone="muted">
            {t('help.contact.hint')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
      </Card>

      <Spacer h={spacing.xxl} />
      <Text variant="subheading" weight="bold">
        {t('help.faq')}
      </Text>
      <Spacer h={spacing.md} />

      <Card style={styles.list} padding={0}>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <Pressable
              key={item.q}
              onPress={() => setOpen(expanded ? null : i)}
              accessibilityRole="button"
              accessible
              // The answer is read as part of the row when it is open, so a screen reader user
              // hears what sighted users see rather than "expanded" and nothing else.
              accessibilityLabel={expanded ? `${item.q}. ${item.a}` : item.q}
              accessibilityState={{ expanded }}
              aria-expanded={expanded}
              style={[styles.item, i < FAQ.length - 1 && styles.itemDivider]}
            >
              <View style={styles.itemHead} importantForAccessibility="no-hide-descendants">
                <Text variant="label" weight="semibold" style={styles.itemQ}>
                  {item.q}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={palette.textMuted} />
              </View>
              {expanded ? (
                <Animated.View entering={reduced ? undefined : FadeInDown.duration(220)} importantForAccessibility="no-hide-descendants">
                  <Spacer h={spacing.sm} />
                  <Text variant="caption" tone="secondary">
                    {item.a}
                  </Text>
                </Animated.View>
              ) : null}
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  contact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  contactIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.chip.blue.bg, alignItems: 'center', justifyContent: 'center' },
  contactText: { flex: 1, gap: 1 },
  list: { gap: 0, overflow: 'hidden' },
  item: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  itemDivider: { borderBottomWidth: 1, borderBottomColor: palette.surfaceMuted },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemQ: { flex: 1 },
});
