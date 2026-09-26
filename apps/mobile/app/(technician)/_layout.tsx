import { Tabs } from 'expo-router';
import { useStrings } from '@/i18n';
import { FloatingTabBar, type TabSpec } from '@/ui';

/**
 * A technician's app is deliberately the smallest in the product: two tabs.
 *
 * They do not win work, quote for it or get paid by us - their contractor does all three. What
 * they need is where they are going next and how to run the job when they arrive. Giving them
 * the provider screens, as we did until now, showed them earnings that are not theirs and a
 * bidding feed they cannot use.
 */
export default function TechnicianTabs() {
  const t = useStrings();
  const specs: TabSpec[] = [
    { name: 'jobs', label: t('tabs.jobs'), icon: 'navigate-outline', iconActive: 'navigate' },
    { name: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
