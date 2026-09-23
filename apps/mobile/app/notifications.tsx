import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NotificationView } from '@hyperlocal/core';
import { useMarkNotificationsRead, useNotifications } from '@/api/reach';
import { palette, radius, spacing } from '@/theme';
import { Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  JOB: 'briefcase-outline',
  OFFER: 'pricetag-outline',
  MONEY: 'wallet-outline',
  ACCOUNT: 'shield-checkmark-outline',
  MARKETING: 'megaphone-outline',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();

  // Opening the list is reading it. There is no "mark as read" button because there is nothing
  // for one to do that opening the screen has not already done.
  const hasUnread = (list.data?.unread ?? 0) > 0;
  const mark = markRead.mutate;
  useEffect(() => {
    if (hasUnread) mark(undefined);
  }, [hasUnread, mark]);

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={{ flex: 1 }}>
          Updates
        </Text>
        <Pressable onPress={() => router.push('/notification-settings')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Notification settings">
          <Ionicons name="options-outline" size={22} color={palette.textMuted} />
        </Pressable>
      </View>
      <Spacer h={spacing.lg} />

      {list.isPending ? (
        <View style={styles.list}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : list.isError ? (
        <ErrorState title="Could not load your updates" body="Check your connection and try again." onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Nothing yet"
          body="When something happens on a booking - an offer, an arrival, a payment - it will appear here."
        />
      ) : (
        <View style={styles.list}>
          {list.data.items.map((n, i) => (
            <Animated.View key={n.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(300)}>
              <Row notification={n} onOpen={() => openFor(n, router)} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function openFor(n: NotificationView, router: ReturnType<typeof useRouter>) {
  const jobId = (n.data as { jobId?: string }).jobId;
  if (jobId) router.push(`/(customer)/job/${jobId}`);
}

function Row({ notification, onOpen }: { notification: NotificationView; onOpen: () => void }) {
  const unread = !notification.readAt;
  const jobId = (notification.data as { jobId?: string }).jobId;
  return (
    <Pressable onPress={jobId ? onOpen : undefined} accessibilityRole={jobId ? 'button' : undefined}>
      <Card style={[styles.row, unread && styles.rowUnread]}>
        <View style={[styles.icon, unread && styles.iconUnread]}>
          <Ionicons
            name={ICON[notification.category] ?? 'notifications-outline'}
            size={18}
            color={unread ? palette.primary : palette.textMuted}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={unread ? 'bold' : 'semibold'}>
            {notification.title}
          </Text>
          <Text variant="micro" tone="muted">
            {notification.body}
          </Text>
          <Text variant="micro" tone="muted">
            {timeAgo(notification.createdAt)}
          </Text>
        </View>
        {jobId ? <Ionicons name="chevron-forward" size={16} color={palette.textMuted} /> : null}
      </Card>
    </Pressable>
  );
}

/** "3 hours ago" reads better than a timestamp for something that just happened. */
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowUnread: { borderWidth: 1, borderColor: palette.primary },
  icon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6FBF9' },
  iconUnread: { backgroundColor: '#E8F6F1' },
});
