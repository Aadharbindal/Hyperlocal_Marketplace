import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { MAX_RESCHEDULE_DAYS_AHEAD, checkReason, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useProposeTime, useRescheduleBooking, useRespondToProposal, useTimeProposal, useWithdrawProposal } from '@/api/jobs';
import { palette, spacing } from '@/theme';
import { Button, Card, DateTimeField, Text, TextField } from '@/ui';

/**
 * Moving a booking instead of losing it.
 *
 * The API for this has existed, tested on both sides, with nothing calling it - so a customer who
 * could not be home on Tuesday had to cancel and start over. That costs them the price they had
 * already agreed and costs the professional the job, for what is usually a two-hour problem.
 *
 * One component for both sides, but the two sides do **different things**, and the asymmetry is
 * deliberate rather than an oversight:
 *
 *   - the customer's time is theirs to arrange, so they move the booking outright and the
 *     professional is told, because they had blocked a slot for it. The server caps the number
 *     of moves and refuses once somebody may already be travelling.
 *   - the professional has to *ask*. Their proposal changes nothing until the customer answers.
 *
 * `mine` on a pending proposal is what decides who is being asked, so the two screens cannot
 * disagree about whose turn it is.
 */

/** Suggesting a move is pointless once somebody is at the door or working. */
const MOVEABLE: JobStatus[] = ['CONFIRMED', 'PROVIDER_ASSIGNED'];

export function RescheduleCard({ jobId, status, side }: { jobId: string; status: JobStatus; side: 'CUSTOMER' | 'PROVIDER' }) {
  const enabled = MOVEABLE.includes(status);
  const proposal = useTimeProposal(jobId, enabled);
  const propose = useProposeTime();
  const reschedule = useRescheduleBooking();
  const respond = useRespondToProposal();
  const withdraw = useWithdrawProposal();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;
  const live = proposal.data?.proposal ?? null;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'That did not go through.');

  /**
   * The chosen moment, or null.
   *
   * This used to be a string somebody typed as `YYYY-MM-DD HH:MM`, parsed with a regex here. It was
   * shipped knowingly as the smallest thing that made rescheduling reachable at all, and recorded
   * in KNOWN_LIMITATIONS as such - but it asked a person to know the format, the year, the
   * 24-hour conversion and which days exist in which month, which is four pieces of homework to
   * move a booking by two hours. The calendar does all of that now.
   */
  const parsed = when;
  /** The provider must say why; for the customer the field is optional, so empty is not a problem. */
  const reasonProblem = reason.trim() ? checkReason(reason) : null;

  async function send() {
    setError(null);
    if (!parsed) return;
    try {
      if (side === 'CUSTOMER') {
        const res = await reschedule.mutateAsync({
          jobId,
          newStart: parsed.toISOString(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        Alert.alert(
          'Moved',
          res.providerNotified
            ? `The professional has been told. You can move this booking ${res.movesLeft} more time${res.movesLeft === 1 ? '' : 's'}.`
            : 'Your booking has been moved.',
        );
      } else {
        await propose.mutateAsync({ jobId, newStart: parsed.toISOString(), reason: reason.trim() });
      }
      setOpen(false);
      setWhen(null);
      setReason('');
    } catch (e) {
      fail(e);
    }
  }

  async function answer(accept: boolean) {
    setError(null);
    if (!live) return;
    try {
      await respond.mutateAsync({ proposalId: live.id, jobId, accept });
      if (accept) Alert.alert('Moved', 'The booking has been moved to the new time.');
    } catch (e) {
      fail(e);
    }
  }

  const pretty = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // ---- somebody has suggested a time and it is waiting on an answer ----------------------
  if (live && live.status === 'PENDING') {
    return (
      <Animated.View entering={reduced ? undefined : FadeInDown.duration(300)}>
        <Card style={styles.card}>
          <View style={styles.head}>
            <View style={styles.icon}>
              <Ionicons name="time-outline" size={19} color={palette.primaryDeep} />
            </View>
            <Text variant="label" weight="bold" style={{ flex: 1 }}>
              {live.mine ? 'Waiting on a new time' : 'A new time has been suggested'}
            </Text>
          </View>

          <Text variant="subheading" weight="bold">
            {pretty(live.newStart)}
          </Text>
          <Text variant="caption" tone="secondary">
            {live.reason}
          </Text>

          {error ? (
            <Text variant="micro" tone="danger">
              {error}
            </Text>
          ) : null}

          {live.mine ? (
            <>
              <Text variant="micro" tone="muted">
                {side === 'CUSTOMER'
                  ? 'Nothing moves until the professional agrees. Your original time still stands.'
                  : 'Nothing moves until the customer agrees. The original time still stands.'}
              </Text>
              <Button
                title="Withdraw"
                size="sm"
                variant="ghost"
                fullWidth
                loading={withdraw.isPending}
                onPress={() => void withdraw.mutateAsync({ proposalId: live.id, jobId }).catch(fail)}
              />
            </>
          ) : (
            <View style={styles.actions}>
              <Button title="No, keep the time" size="sm" variant="secondary" style={styles.action} loading={respond.isPending} onPress={() => void answer(false)} />
              <Button title="That works" size="sm" style={styles.action} loading={respond.isPending} onPress={() => void answer(true)} />
            </View>
          )}
        </Card>
      </Animated.View>
    );
  }

  // ---- nothing pending: offer to suggest one ---------------------------------------------
  if (!open) {
    return (
      <Button
        title={side === 'CUSTOMER' ? 'Move this booking' : 'Suggest another time'}
        size="sm"
        variant="ghost"
        fullWidth
        icon="calendar-outline"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <Animated.View entering={reduced ? undefined : FadeInDown.duration(240)}>
      <Card style={styles.card}>
        <Text variant="caption" weight="semibold">
          {side === 'CUSTOMER' ? 'Move this booking' : 'Suggest another time'}
        </Text>
        <DateTimeField
          label="New time"
          value={when}
          onChange={setWhen}
          // Ninety days matches the ceiling the shared validator enforces, so the dial cannot reach
          // a date the form would then refuse. A picker that offers an unpickable day is worse than
          // a text box, because the refusal makes no sense.
          maximumDate={new Date(Date.now() + MAX_RESCHEDULE_DAYS_AHEAD * 86_400_000)}
          helper={side === 'CUSTOMER' ? 'Any time from now on' : 'Suggest a slot that suits you'}
        />
        <TextField
          label={side === 'CUSTOMER' ? 'Why (optional)' : 'Why you need to move it'}
          helper={side === 'CUSTOMER' ? 'The professional sees this' : 'The customer sees this'}
          value={reason}
          onChangeText={setReason}
          placeholder={side === 'CUSTOMER' ? 'Running late from work' : 'Previous job has overrun'}
          icon="chatbubble-ellipses-outline"
          multiline
          minLines={2}
          maxLength={240}
          counter
          required={side === 'PROVIDER'}
          error={reasonProblem?.message ?? null}
        />
        {error ? (
          <Text variant="micro" tone="danger">
            {error}
          </Text>
        ) : null}
        <Text variant="micro" tone="muted">
          {side === 'CUSTOMER'
            ? 'The price stays the same. The professional is told straight away, and there is a limit on how many times a booking can move.'
            : 'Nothing changes until the customer agrees, and the price stays the same.'}
        </Text>
        <View style={styles.actions}>
          <Button title="Cancel" size="sm" variant="ghost" style={styles.action} onPress={() => setOpen(false)} />
          <Button
            title={side === 'CUSTOMER' ? 'Move it' : 'Suggest it'}
            size="sm"
            style={styles.action}
            // The provider must give a reason of at least ten characters; the customer need not
            // explain moving their own booking. Enforced here too, because a rejection after
            // typing is a worse way to learn it.
            disabled={!parsed || !!reasonProblem || (side === 'PROVIDER' && !!checkReason(reason))}
            loading={propose.isPending || reschedule.isPending}
            onPress={() => void send()}
          />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
