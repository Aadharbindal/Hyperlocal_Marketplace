import { Tabs } from 'expo-router';
import { useStrings } from '@/i18n';
import { FloatingTabBar, type TabSpec } from '@/ui';

export default function CustomerTabs() {
  const t = useStrings();
  const specs: TabSpec[] = [
    { name: 'home', label: t('tabs.home'), icon: 'home-outline', iconActive: 'home' },
    { name: 'bookings', label: t('tabs.bookings'), icon: 'calendar-outline', iconActive: 'calendar' },
    { name: 'messages', label: t('tabs.messages'), icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
    { name: 'profile', label: t('tabs.profile'), icon: 'person-outline', iconActive: 'person' },
  ];
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} specs={specs} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
