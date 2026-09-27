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
import { useLiveUpdates } from '@/api/live';
import { installGlobalCrashHandlers } from '@/api/crash';
import { usePushRegistration } from '@/api/push';

// Installed before anything renders, so a crash during startup is still reported.
installGlobalCrashHandlers();

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
  // One live connection for the whole app; it marks queries stale rather than carrying data.
  useLiveUpdates();
  // And one registration, so anything that happens while the app is closed still reaches them.
  usePushRegistration();
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
    // Each role gets the app it needs. A technician used to be given the provider screens,
    // which showed them a bidding feed they cannot use and earnings that belong to their
    // contractor; they now have two tabs of their own.
    const target =
      activeRole === 'ADMIN' || activeRole === 'SUPPORT'
        ? '(admin)'
        : activeRole === 'VENDOR'
          ? '(vendor)'
          : activeRole === 'CONTRACTOR'
            ? '(contractor)'
            : activeRole === 'TECHNICIAN'
              ? '(technician)'
              : activeRole === 'PROVIDER'
                ? '(provider)'
                : '(customer)';
    const home =
      target === '(admin)'
        ? '/(admin)/queue'
        : target === '(vendor)'
          ? '/(vendor)/requests'
          : target === '(contractor)'
            ? '/(contractor)/jobs'
            : target === '(technician)'
              ? '/(technician)/jobs'
              : target === '(provider)'
                ? '/(provider)/jobs'
                : '/(customer)/home';
    // Only a *group* can be the wrong place to be.
    //
    // This used to read `if (group !== target)`, which was true for every screen that does not
    // live inside a role group - `/receipts`, `/addresses`, `/favourites`, `/referrals`,
    // `/notifications`, `/warranty-claims`, `/search`, `/invoice/[id]` and the rest. Opening any
    // of them bounced straight back to the role's home, so a dozen built screens were
    // unreachable from inside the app. Nothing failed; the tap simply did nothing, which is why
    // no test caught it and why it took tapping through on a phone to find.
    //
    // Shared screens belong to every role, so being on one is not being in the wrong place. An
    // empty `group` is the index route, which does still need sending home.
    const inRoleGroup = typeof group === 'string' && group.startsWith('(');
    if (!group || (inRoleGroup && group !== target)) router.replace(home as never);
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
