import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { FlaggedMessageView, ModerationOutcome } from '@hyperlocal/core';
import { useFlaggedMessages, useReviewMessage } from '@/api/admin-trust';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

/**
 * The queue for messages the contact filter caught.
 *
 * These have been flagged since M5 and, until this screen, nobody could read one. A flag nobody
 * reads is worse than no flag: it is the appearance of moderation without the fact of it - and
 * that appearance is what we would be leaning on if somebody asked how we police off-platform
 * payment.
 *
 * Clearing a message is deliberately the easiest action on the screen. Most flags are somebody
 * sharing a number so a delivery can be let through the gate, and a queue where the innocent
 * case is fiddly is a queue that stops being worked.
 */

const OUTCOMES: Array<{ value: ModerationOutcome; label: string; hint: string; tone: 'neutral' | 'warning' | 'danger' }> = [
  { value: 'ALLOWED', label: 'Fine', hint: 'Nothing happens. Most flags are innocent.', tone: 'neutral' },
  { value: 'WARNED', label: 'Warn', hint: 'A note to the sender. No mark on their record.', tone: 'warning' },
  { value: 'STRIKE', label: 'Strike', hint: 'A mark on their record. Counts toward suspension.', tone: 'danger' },
  { value: 'SUSPENDED', label: 'Suspend', hint: 'A major strike. Review their account separately.', tone: 'danger' },
];

export default function ModerationScreen() {
  const queue = useFlaggedMessages();
  const review = useReviewMessage();
  const [reviewing, setReviewing] = useState<FlaggedMessageView | null>(null);

  return (
    <Screen withTabBar refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title" weight="bold">
            Flagged messages
          </Text>
          <Text variant="caption" tone="secondary">
            {queue.data?.items.length
              ? `${queue.data.items.length} to read${queue.data.overdue ? ` · ${queue.data.overdue} overdue` : ''}`
              : 'Contact details caught in chat'}
          </Text>
        </View>
      </View>
      <Spacer h={spacing.lg} />

      {queue.isPending ? (
        <View style={styles.list}>
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : queue.isError ? (
        <ErrorState title="Could not load the queue" body="Check your connection and try again." onRetry={() => void queue.refetch()} />
      ) : queue.data.items.length === 0 ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="Nothing to read"
          body="Messages with a phone number, an email or a UPI handle appear here as they are sent."
        />
      ) : (
        <View style={styles.list}>
          {queue.data.items.map((message, i) => (
            <Animated.View key={message.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(300)}>
              <Card style={[styles.card, message.overdue && styles.cardOverdue]}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" weight="semibold">
                      {message.senderName}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {message.senderRole.toLowerCase()} ·{' '}
                      {new Date(message.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  {message.overdue ? <Badge tone="danger" label="overdue" /> : null}
                  {message.flagReason ? <Badge tone="warning" label={message.flagReason.toLowerCase().replace(/_/g, ' ')} /> : null}
                </View>

                {/* The message itself, verbatim. A reviewer deciding on a summary is deciding
                    on somebody else's reading of it. */}
                <View style={styles.message}>
                  <Text variant="caption" tone="secondary">
                    {message.body}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <Button
                    title="Fine"
                    size="sm"
                    variant="secondary"
                    style={styles.action}
                    disabled={review.isPending}
                    onPress={() => review.mutate({ id: message.id, outcome: 'ALLOWED' })}
                  />
                  <Button title="Act on it" size="sm" style={styles.action} onPress={() => setReviewing(message)} />
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <ReviewSheet message={reviewing} onClose={() => setReviewing(null)} />
    </Screen>
  );
}

function ReviewSheet({ message, onClose }: { message: FlaggedMessageView | null; onClose: () => void }) {
  const review = useReviewMessage();
  const [outcome, setOutcome] = useState<ModerationOutcome>('WARNED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message) return;
    setError(null);
    try {
      await review.mutateAsync({ id: message.id, outcome, reason: reason.trim() || undefined });
      setReason('');
      onClose();
    } catch {
      setError('Could not record that. Try again.');
    }
  }

  const needsReason = outcome !== 'ALLOWED';

  return (
    <Modal visible={!!message} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          What should happen?
        </Text>
        <Spacer h={spacing.md} />

        {OUTCOMES.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => setOutcome(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: outcome === o.value }}
            style={[styles.option, outcome === o.value && styles.optionOn]}
          >
            <Ionicons
              name={outcome === o.value ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={outcome === o.value ? palette.primary : palette.textMuted}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight="semibold">
                {o.label}
              </Text>
              <Text variant="micro" tone="muted">
                {o.hint}
              </Text>
            </View>
          </Pressable>
        ))}

        {needsReason ? (
          <>
            <Spacer h={spacing.md} />
            <TextField
              label="Why"
              value={reason}
              onChangeText={setReason}
              placeholder="Soliciting payment outside the platform"
              helper="Recorded against the decision, and read if they appeal."
            />
          </>
        ) : null}

        {error ? (
          <Text variant="micro" style={{ color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <Spacer h={spacing.sm} />
        <Button
          title="Record this"
          fullWidth
          loading={review.isPending}
          disabled={needsReason && reason.trim().length < 5}
          onPress={() => void submit()}
        />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  cardOverdue: { borderWidth: 1, borderColor: palette.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  message: { backgroundColor: '#F6FBF9', borderRadius: radius.sm, padding: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  optionOn: { backgroundColor: '#F6FBF9' },
});
