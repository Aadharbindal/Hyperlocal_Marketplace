import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';

export default function MessagesScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.messages')}</Text>
      <Spacer />
      <EmptyState icon="chatbubble-ellipses-outline" title={t('messages.empty.title')} body={t('messages.empty.body')} />
    </Screen>
  );
}
