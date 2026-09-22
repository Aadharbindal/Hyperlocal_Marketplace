import { Tabs } from 'expo-router';
import { useStrings } from '@/i18n';
import { FloatingTabBar, type TabSpec } from '@/ui';

export default function ProviderTabs() {
  const t = useStrings();
  const specs: TabSpec[] = [
    { name: 'jobs', label: t('tabs.jobs'), icon: 'briefcase-outline', iconActive: 'briefcase' },
    { name: 'active', label: t('tabs.active'), icon: 'flash-outline', iconActive: 'flash' },
    { name: 'earnings', label: t('tabs.earnings'), icon: 'wallet-outline', iconActive: 'wallet' },
    { name: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="active" />
      <Tabs.Screen name="earnings" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
