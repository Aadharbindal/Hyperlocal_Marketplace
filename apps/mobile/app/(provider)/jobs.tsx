import { useMe } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { Badge, EmptyState, Screen, Spacer, Text } from '@/ui';
import { JobsEmptyIllustration } from '@/ui/illustrations';
export default function ProviderJobsScreen() {
  const t = useStrings();
  const me = useMe();
  const status = me.data?.profiles.provider?.verificationStatus ?? 'UNVERIFIED';
  return (
    <Screen withTabBar refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <Text variant="title">{t('tabs.jobs')}</Text>
      <Spacer h={8} />
      {status !== 'VERIFIED' ? <Badge tone="warning" icon="time-outline" label={t('jobs.unverified')} /> : <Badge tone="success" icon="shield-checkmark" label="Verified" />}
      <Spacer />
      <EmptyState illustration={<JobsEmptyIllustration />} title={t('jobs.empty.title')} body={t('jobs.empty.body')} />
    </Screen>
  );
}
