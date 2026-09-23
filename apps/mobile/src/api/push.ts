import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from './client';
import { reachKeys } from './reach';
import { useSession } from '@/store/session';

/**
 * Getting this installation registered so notifications can actually arrive, and doing
 * something sensible when one is tapped.
 *
 * Two judgement calls worth stating:
 *
 * 1. **The permission prompt is not asked for here.** Asking on first launch, before anyone has
 *    booked anything, is how an app gets permanently declined - and on iOS a declined prompt
 *    cannot be asked again. This registers only when permission has *already* been granted;
 *    asking is a deliberate act elsewhere, at a moment when the reason is obvious.
 * 2. **The token is sent on every launch**, not only the first. The operating system rotates
 *    it, and a stale token is somebody who quietly stops hearing from us and never finds out.
 */

// A notification that arrives while the app is open should be visible, not silently swallowed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

async function currentToken(): Promise<string | null> {
  // A simulator has no push service behind it, so there is nothing to register.
  if (!Device.isDevice) return null;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status !== 'granted') return null;
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}

/** Asks for permission. Call this from a screen where the person can see why it is being asked. */
export async function askForNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.status === 'granted';
}

export async function registerDevice(deviceLabel?: string) {
  const token = await currentToken();
  if (!token) return null;
  const platform = Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB';
  await api('/me/devices', { method: 'POST', body: { token, platform, deviceLabel: deviceLabel ?? Device.modelName ?? undefined } });
  return token;
}

/**
 * Mounted once, at the root. Registers the device when somebody is signed in, and sends them to
 * the right place when they tap a notification - which is the whole reason a notification is
 * worth sending.
 */
export function usePushRegistration() {
  const accessToken = useSession((s) => s.accessToken);
  const router = useRouter();
  const qc = useQueryClient();
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      registered.current = null;
      return;
    }
    void registerDevice()
      .then((token) => {
        registered.current = token;
      })
      .catch(() => {
        // Not being able to register is not worth interrupting anyone over: the in-app list
        // still works, and the next launch tries again.
      });
  }, [accessToken]);

  useEffect(() => {
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { jobId?: string } | undefined;
      void qc.invalidateQueries({ queryKey: reachKeys.notifications() });
      // A notification about a job opens that job. Anything else opens the list it came from.
      if (data?.jobId) router.push(`/(customer)/job/${data.jobId}`);
      else router.push('/notifications');
    });

    const arrived = Notifications.addNotificationReceivedListener(() => {
      // Arriving while the app is open should update the badge without a round trip.
      void qc.invalidateQueries({ queryKey: reachKeys.notifications() });
    });

    return () => {
      tapped.remove();
      arrived.remove();
    };
  }, [router, qc]);
}
