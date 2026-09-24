import { Tabs } from 'expo-router';
import { useStrings } from '@/i18n';
import { FloatingTabBar, type TabSpec } from '@/ui';

/**
 * A contractor's day: the jobs their crew has won, the crew itself, what they have earned, and
 * their own account. Deliberately four tabs and no more - this is a screen somebody checks
 * between site visits, not a management console.
 */
export default function ContractorTabs() {
  const t = useStrings();
  const specs: TabSpec[] = [
    { name: 'jobs', label: t('tabs.jobs'), icon: 'briefcase-outline', iconActive: 'briefcase' },
    { name: 'team', label: t('tabs.team'), icon: 'people-outline', iconActive: 'people' },
    { name: 'earnings', label: t('tabs.earnings'), icon: 'wallet-outline', iconActive: 'wallet' },
    { name: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="team" />
      <Tabs.Screen name="earnings" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
