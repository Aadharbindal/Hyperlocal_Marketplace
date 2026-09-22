import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';

export default function BookingsScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.bookings')}</Text>
      <Spacer />
      <EmptyState icon="calendar-outline" title={t('bookings.empty.title')} body={t('bookings.empty.body')} />
    </Screen>
  );
}
