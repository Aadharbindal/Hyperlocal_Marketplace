import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';

export default function EarningsScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.earnings')}</Text>
      <Spacer />
      <EmptyState icon="wallet-outline" title={t('earnings.empty.title')} body={t('earnings.empty.body')} />
    </Screen>
  );
}
