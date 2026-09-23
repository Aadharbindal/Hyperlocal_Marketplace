import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CallView,
  NotificationListView,
  NotificationSettingsBody,
  NotificationSettingsView,
  RescheduleView,
} from '@hyperlocal/core';
import { api } from './client';
import { jobKeys } from './jobs';

export const reachKeys = {
  notifications: () => ['me', 'notifications'] as const,
  notificationSettings: () => ['me', 'notification-settings'] as const,
  devices: () => ['me', 'devices'] as const,
};

/**
 * The notification list, with the number the badge shows. Polled gently: the live stream
 * already nudges this the moment anything arrives, so this is the fallback for when the stream
 * is not connected.
 */
export function useNotifications() {
  return useQuery({
    queryKey: reachKeys.notifications(),
    queryFn: () => api<NotificationListView>('/me/notifications'),
    staleTime: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api<{ marked: number; unread: number }>('/me/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    // Opening the list clears the badge immediately; the server agreeing is a formality.
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: reachKeys.notifications() });
      const previous = qc.getQueryData<NotificationListView>(reachKeys.notifications());
      if (previous) {
        const now = new Date().toISOString();
        qc.setQueryData<NotificationListView>(reachKeys.notifications(), {
          items: previous.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
          unread: ids ? Math.max(0, previous.unread - ids.length) : 0,
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(reachKeys.notifications(), ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: reachKeys.notifications() }),
  });
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: reachKeys.notificationSettings(),
    queryFn: () => api<NotificationSettingsView>('/me/notification-settings'),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationSettingsBody) =>
      api<NotificationSettingsView>('/me/notification-settings', { method: 'PATCH', body }),
    onSuccess: (view) => qc.setQueryData(reachKeys.notificationSettings(), view),
  });
}

/** Registering this installation so notifications have somewhere to go. */
export function useRegisterDevice() {
  return useMutation({
    mutationFn: (body: { token: string; platform: 'IOS' | 'ANDROID' | 'WEB'; deviceLabel?: string; appVersion?: string }) =>
      api<{ device: { id: string } }>('/me/devices', { method: 'POST', body }),
  });
}

/**
 * Asks the telephony provider to put a number in the middle. What comes back is a number to
 * dial - never the other person's own, in either direction.
 */
export function useStartCall(jobId: string | undefined) {
  return useMutation({
    mutationFn: (input: { urgent?: boolean } = {}) =>
      api<{ call: CallView }>(`/jobs/${jobId}/call`, { method: 'POST', body: input }),
  });
}

export function useReschedule(jobId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { newStart: string; newEnd?: string; reason?: string }) =>
      api<RescheduleView>(`/jobs/${jobId}/reschedule`, { method: 'POST', body }),
    onSuccess: () => {
      if (jobId) void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
