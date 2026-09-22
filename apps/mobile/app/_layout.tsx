import { useFonts } from 'expo-font';
// Import only the weights we ship, not the whole family.
import Poppins_400Regular from '@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf';
import Poppins_500Medium from '@expo-google-fonts/poppins/500Medium/Poppins_500Medium.ttf';
import Poppins_600SemiBold from '@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf';
import Poppins_700Bold from '@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf';
import Poppins_800ExtraBold from '@expo-google-fonts/poppins/800ExtraBold/Poppins_800ExtraBold.ttf';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import { useMe } from '@/api/hooks';
import { ErrorBoundary } from '@/features/ErrorBoundary';
import { useNetwork } from '@/store/network';
import { useSession } from '@/store/session';
import { palette } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** Decides which route group the user belongs in: (auth) -> role picker -> role tabs. */
function AuthGate() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const hydrated = useSession((s) => s.hydrated);
  const token = useSession((s) => s.accessToken);
  const user = useSession((s) => s.user);
  const activeRole = useSession((s) => s.activeRole);
  const me = useMe(!!token);

  useEffect(() => {
    if (!hydrated) return;
    const group = segments[0];
    if (!token) {
      if (group !== '(auth)') router.replace('/(auth)/phone');
      return;
    }
    if (!user) return; // /me still loading
    const roles = user.roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role);
    if (roles.length === 0) {
      if (segments[1] !== 'role') router.replace('/(auth)/role');
      return;
    }
    const target = activeRole === 'PROVIDER' || activeRole === 'CONTRACTOR' || activeRole === 'TECHNICIAN' ? '(provider)' : '(customer)';
    if (group !== target) router.replace(target === '(provider)' ? '/(provider)/jobs' : '/(customer)/home');
  }, [hydrated, token, user, activeRole, segments, router]);

  if (!hydrated || (token && !user && me.isPending)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.ground }}>
        <ActivityIndicator color={palette.primary} size="large" />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.ground } }} />;
}

export default function RootLayout() {
  const hydrate = useSession((s) => s.hydrate);
  const startNetwork = useNetwork((s) => s.start);
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  useEffect(() => {
    void hydrate();
    return startNetwork();
  }, [hydrate, startNetwork]);

  // Hold the first paint until the brand face is ready so text never reflows.
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.ground }}>
        <ActivityIndicator color={palette.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <AuthGate />
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
