import { useStrings } from '@/i18n';
import { EmptyState, Screen, Spacer, Text } from '@/ui';
import { MessagesEmptyIllustration } from '@/ui/illustrations';
export default function MessagesScreen() {
  const t = useStrings();
  return (
    <Screen withTabBar>
      <Text variant="title">{t('tabs.messages')}</Text>
      <Spacer />
      <EmptyState illustration={<MessagesEmptyIllustration />} title={t('messages.empty.title')} body={t('messages.empty.body')} />
    </Screen>
  );
}
