import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUS_LABEL,
  checkMeaningfulText,
  type SupportCategory,
  type SupportTicketStatus,
} from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useRaiseSupportTicket, useSupportTickets } from '@/api/finance';
import { palette, spacing } from '@/theme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SegmentedControl,
  Skeleton,
  Spacer,
  Text,
  TextField,
} from '@/ui';

/**
 * Reaching a person.
 *
 * The API for this has existed since the finance work, tested, with nothing calling it. "Talk to
 * support" on the help screen opened a `mailto:` to `support@hyperlocal.example` - a reserved TLD
 * that cannot receive mail, from a phone that may have no mail client set up at all. So the single
 * route out of a problem went nowhere, silently, and the person had no way to know that.
 *
 * What makes this worth more than the mailto is not the form, it is the list underneath it.
 * Somebody who has written in wants to know it arrived and whether anybody has picked it up; an
 * email gives them neither, and the absence of an answer is indistinguishable from the absence of
 * a message.
 */
export default function SupportScreen() {
  const router = useRouter();
  const tickets = useSupportTickets();
  const raise = useRaiseSupportTicket();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportCategory>('BOOKING');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const items = tickets.data?.items ?? [];
  const subjectProblem = subject.trim() ? checkMeaningfulText(subject, 3, 'A subject') : null;
  const bodyProblem = body.trim() ? checkMeaningfulText(body, 10, 'Your message') : null;
  const canSend = !!subject.trim() && !subjectProblem && !!body.trim() && !bodyProblem;

  async function send() {
    setError(null);
    try {
      await raise.mutateAsync({ category, subject: subject.trim(), body: body.trim() });
      setSubject('');
      setBody('');
      setOpen(false);
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not send. Please try again.');
    }
  }

  /** `RESOLVED` is good news and `WAITING` is a nudge; the rest are simply in progress. */
  const toneFor = (s: SupportTicketStatus) =>
    s === 'RESOLVED' ? 'success' : s === 'WAITING' ? 'warning' : s === 'CLOSED' ? 'neutral' : 'primary';

  return (
    <Screen keyboard refreshing={tickets.isRefetching} onRefresh={() => void tickets.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={styles.flex}>
          Talk to support
        </Text>
      </View>
      <Spacer h={spacing.md} />
      <Text variant="caption" tone="secondary">
        A person reads every one of these. Weekdays, 9am to 8pm - outside those hours it waits until
        morning rather than disappearing.
      </Text>
      <Spacer h={spacing.xl} />

      {sent && !open ? (
        <>
          <Card style={styles.sent}>
            <Ionicons name="checkmark-circle" size={20} color={palette.success} />
            <Text variant="caption" style={styles.flex}>
              Sent. It is in the list below, and you will get a notification when somebody replies.
            </Text>
          </Card>
          <Spacer h={spacing.lg} />
        </>
      ) : null}

      {open ? (
        <Animated.View entering={reduced ? undefined : FadeInDown.duration(300)}>
          <Card style={styles.form}>
            <Text variant="label" weight="semibold">
              What is it about?
            </Text>
            <SegmentedControl
              label="What is it about"
              options={SUPPORT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              value={category}
              onChange={setCategory}
            />
            <TextField
              label="One line"
              helper="So somebody can see what this is without opening it"
              value={subject}
              onChangeText={setSubject}
              placeholder="Charged twice for one booking"
              maxLength={120}
              required
              error={subjectProblem?.message ?? null}
            />
            <TextField
              label="What happened"
              value={body}
              onChangeText={setBody}
              placeholder="The payment went through twice on Tuesday for the same plumbing job."
              multiline
              minLines={4}
              maxLength={2000}
              counter
              required
              error={bodyProblem?.message ?? null}
            />
            {error ? (
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button title="Cancel" variant="ghost" size="md" onPress={() => setOpen(false)} />
              <Button title="Send" size="md" loading={raise.isPending} disabled={!canSend} onPress={() => void send()} />
            </View>
          </Card>
          <Spacer h={spacing.xl} />
        </Animated.View>
      ) : (
        <>
          <Button title="Write to support" fullWidth icon="create-outline" onPress={() => setOpen(true)} />
          <Spacer h={spacing.xl} />
        </>
      )}

      <Text variant="heading" weight="bold">
        Your messages
      </Text>
      <Spacer h={spacing.md} />

      {tickets.isPending ? (
        <View style={styles.list}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : tickets.isError ? (
        /* Not an empty list. Somebody who has written in and is waiting needs to know the
           difference between "nothing here" and "we could not look". */
        <ErrorState
          title="We could not load your messages"
          body="They are still there. Check your connection and try again."
          onRetry={() => void tickets.refetch()}
          retrying={tickets.isRefetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="Nothing yet"
          body="Anything you write to us appears here with where it has got to."
        />
      ) : (
        <View style={styles.list}>
          {items.map((ticket, i) => (
            <Animated.View key={ticket.id} entering={reduced ? undefined : FadeInDown.delay(Math.min(i, 5) * 50).duration(300)}>
              <Card padding="md">
                <ListRow
                  title={ticket.subject}
                  subtitle={SUPPORT_CATEGORIES.find((c) => c.value === ticket.category)?.label ?? ticket.category}
                  meta={new Date(ticket.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  icon="chatbubble-ellipses-outline"
                  badge={{ label: SUPPORT_STATUS_LABEL[ticket.status], tone: toneFor(ticket.status) }}
                />
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <Spacer h={spacing.xl} />
      <Text variant="micro" tone="muted">
        For anything about a specific booking, open that booking instead - reporting a problem there
        holds the payment while it is looked at, which writing here does not.
      </Text>
      <Spacer h={spacing.xxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  form: { gap: spacing.lg },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  list: { gap: spacing.sm },
  sent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
