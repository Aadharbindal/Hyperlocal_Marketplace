import { Tabs } from 'expo-router';
import { FloatingTabBar, type TabSpec } from '@/ui';

export default function AdminTabs() {
  const specs: TabSpec[] = [
    { name: 'queue', label: 'Disputes', icon: 'alert-circle-outline', iconActive: 'alert-circle' },
    { name: 'verify', label: 'Verify', icon: 'shield-outline', iconActive: 'shield-checkmark' },
    { name: 'money', label: 'Money', icon: 'cash-outline', iconActive: 'cash' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="queue" />
      <Tabs.Screen name="verify" />
      <Tabs.Screen name="money" />
    </Tabs>
  );
}
