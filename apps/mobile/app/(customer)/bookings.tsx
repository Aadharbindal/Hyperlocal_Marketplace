import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';
import { BookingsEmptyIllustration } from '@/ui/illustrations';
export default function BookingsScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.bookings')}</Text>
      <Spacer />
      <EmptyState illustration={<BookingsEmptyIllustration />} title={t('bookings.empty.title')} body={t('bookings.empty.body')} />
    </Screen>
  );
}
