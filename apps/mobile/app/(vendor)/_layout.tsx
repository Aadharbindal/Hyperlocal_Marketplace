import { Tabs } from 'expo-router';
import { useStrings } from '@/i18n';
import { FloatingTabBar, type TabSpec } from '@/ui';

export default function VendorTabs() {
  const t = useStrings();
  const specs: TabSpec[] = [
    { name: 'requests', label: t('tabs.requests'), icon: 'list-outline', iconActive: 'list' },
    { name: 'orders', label: t('tabs.orders'), icon: 'cube-outline', iconActive: 'cube' },
    { name: 'shop', label: t('tabs.shop'), icon: 'storefront-outline', iconActive: 'storefront' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="requests" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="shop" />
    </Tabs>
  );
}
