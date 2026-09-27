import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
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

/**
 * Whether the notifications module is usable in this build at all.
 *
 * It is not, in Expo Go: remote push was removed from it in SDK 53, and the module throws.
 * That mattered far more than "push does not work in Expo Go" - this call used to sit
 * unguarded at module scope, so importing this file threw, the module never finished
 * evaluating, its exports came back `undefined`, and expo-router then failed with
 * `Cannot read property 'ErrorBoundary' of undefined`. **The entire app rendered a blank
 * screen because notifications were unavailable.**
 *
 * The lesson is not about Expo Go. A top-level side effect that can throw takes everything
 * with it, and "the notification service is unavailable" is an ordinary condition on a real
 * device too - a de-Googled phone, a restricted work profile, a region where Play Services is
 * missing. Notifications are a convenience; the app is not.
 */
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/**
 * Load the module, or decide we cannot.
 *
 * Deliberately `require` inside a try, not a static import. A static import is hoisted and
 * evaluated before any code in this file runs, so there is nowhere to put a `try` around it -
 * and in Expo Go this module throws on evaluation, which meant importing *this* file threw,
 * its exports came back `undefined`, and expo-router then failed with
 * `Cannot read property 'ErrorBoundary' of undefined`. The whole app rendered a blank screen
 * because notifications were unavailable.
 *
 * The lesson is not about Expo Go. "The notification service is missing" is an ordinary
 * condition on real devices too - a de-Googled phone, a restricted work profile, a region
 * without Play Services. Notifications are a convenience; the app is not.
 */
function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;

  // Expo Go on Android removed remote push in SDK 53 and throws on load. Detected rather than
  // caught, because this module reports its failure to the global error handler as well as
  // throwing - so a `try` keeps the app alive but still produces a red screen in development
  // and a fabricated crash report in production. Not attempting something known to be
  // unavailable is the honest version.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient && Platform.OS === 'android') {
    cached = null;
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    // A notification that arrives while the app is open should be visible, not silently swallowed.
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether this build can do notifications at all. Screens use it to explain rather than fail. */
export const notificationsSupported = () => notifications() !== null;

async function currentToken(): Promise<string | null> {
  // A simulator has no push service behind it, so there is nothing to register.
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return null;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status !== 'granted') return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    // No push service on this device or in this build. Nothing to do, and nothing worth
    // interrupting anybody over: the in-app list is still the source of truth.
    return null;
  }
}

/** Asks for permission. Call this from a screen where the person can see why it is being asked. */
export async function askForNotificationPermission(): Promise<boolean> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return true;
    if (!existing.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.status === 'granted';
  } catch {
    return false;
  }
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
    const Notifications = notifications();
    if (!Notifications) return;
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
