import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ConversationView } from '@hyperlocal/core';
import { useConversations } from '@/api/execution';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { MessagesEmptyIllustration } from '@/ui/illustrations';

/**
 * Everything this person is talking about.
 *
 * This screen used to be the empty state and nothing else - it fetched nothing, so "No messages.
 * Chat with your provider opens once a booking is confirmed." was its only state, and it went on
 * saying it while a conversation was running. Chat is per job and opens from the booking, so
 * nothing had ever needed to ask "what conversations does this person have", and a tab named
 * Messages that structurally cannot show a message is worse than no tab at all.
 *
 * `GET /me/conversations` answers it now. The row opens the booking, because that is where the
 * chat already lives and a second place to read the same thread is a second place to miss it.
 */
export default function MessagesScreen() {
  const t = useStrings();
  const conversations = useConversations();

  return (
    <Screen withTabBar refreshing={conversations.isRefetching} onRefresh={() => void conversations.refetch()}>
      <Text variant="title">{t('tabs.messages')}</Text>
      <Spacer />

      {conversations.isPending ? (
        <View style={styles.list}>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : conversations.isError ? (
        <ErrorState
          title={t('common.loadFailed')}
          body={t('common.checkConnection')}
          onRetry={() => void conversations.refetch()}
          retrying={conversations.isRefetching}
        />
      ) : conversations.data.length === 0 ? (
        <EmptyState illustration={<MessagesEmptyIllustration />} title={t('messages.empty.title')} body={t('messages.empty.body')} />
      ) : (
        <View style={styles.list}>
          {conversations.data.map((c, i) => (
            <Animated.View key={c.threadId} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <ConversationRow conversation={c} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function ConversationRow({ conversation: c }: { conversation: ConversationView }) {
  const router = useRouter();
  const unread = c.unread > 0;

  return (
    <Pressable
      accessibilityRole="button"
      // One element, one name: a row read out as four separate strings loses which name goes with
      // which message.
      accessible
      accessibilityLabel={[
        `${c.otherPartyName}, ${c.categoryName}`,
        c.lastMessage ? `${c.lastMessage.mine ? 'You said' : 'They said'}: ${c.lastMessage.body}` : 'No messages yet',
        unread ? `${c.unread} unread` : '',
        c.open ? '' : 'This booking is finished',
      ]
        .filter(Boolean)
        // A message usually ends in a full stop of its own, and joining on ". " after one gives a
        // screen reader two - which it reads as a longer pause, mid-sentence.
        .map((part) => part.replace(/\.$/, ''))
        .join('. ')}
      onPress={() => router.push({ pathname: '/(customer)/job/[id]', params: { id: c.jobId } })}
    >
      <Card style={[styles.row, unread && styles.rowUnread]}>
        <View style={[styles.avatar, unread && styles.avatarUnread]}>
          <Text variant="label" weight="bold" style={unread ? styles.initialUnread : styles.initial}>
            {c.otherPartyName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.body} importantForAccessibility="no-hide-descendants">
          <View style={styles.head}>
            <Text variant="label" weight={unread ? 'bold' : 'semibold'} numberOfLines={1} style={styles.name}>
              {c.otherPartyName}
            </Text>
            {c.lastMessage ? (
              <Text variant="micro" tone="muted">
                {shortTime(c.lastMessage.at)}
              </Text>
            ) : null}
          </View>

          <Text variant="micro" tone="muted" numberOfLines={1}>
            {c.categoryName}
            {/* Said plainly rather than by greying the row: a finished booking still has a chat
                worth reading, and "closed" is a fact about it, not a reason to hide it. */}
            {c.open ? '' : ' · finished'}
          </Text>

          <Text
            variant="caption"
            tone={unread ? 'default' : 'secondary'}
            weight={unread ? 'semibold' : 'regular'}
            numberOfLines={1}
          >
            {c.lastMessage
              ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.body}`
              : 'No messages yet - say hello'}
          </Text>
        </View>

        {unread ? <Badge tone="primary" label={String(c.unread)} /> : <Ionicons name="chevron-forward" size={16} color={palette.iconFaint} />}
      </Card>
    </Pressable>
  );
}

/**
 * The time if it was today, the day if it was this week, otherwise the date.
 *
 * The same rule a phone's own messages list uses, and for the same reason: in a list, "14:20" is
 * only useful when you already know it was today.
 */
function shortTime(iso: string): string {
  const at = new Date(iso);
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days < 1) return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return at.toLocaleDateString('en-IN', { weekday: 'short' });
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowUnread: { borderWidth: 1, borderColor: palette.primary },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: { backgroundColor: palette.primary },
  initial: { color: palette.primaryDeep },
  initialUnread: { color: palette.textOnPrimary },
  body: { flex: 1, gap: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
});
