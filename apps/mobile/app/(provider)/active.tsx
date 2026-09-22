import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';

export default function ActiveJobsScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.active')}</Text>
      <Spacer />
      <EmptyState icon="flash-outline" title={t('active.empty.title')} body={t('active.empty.body')} />
    </Screen>
  );
}
