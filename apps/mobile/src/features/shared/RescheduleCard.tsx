import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { checkFutureDateTime, checkReason, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useProposeTime, useRescheduleBooking, useRespondToProposal, useTimeProposal, useWithdrawProposal } from '@/api/jobs';
import { palette, radius, spacing, typography } from '@/theme';
import { Button, Card, Text } from '@/ui';

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
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;
  const live = proposal.data?.proposal ?? null;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'That did not go through.');

  /**
   * A date and a time typed as `YYYY-MM-DD HH:MM`, read as local time.
   *
   * A picker would be better and is a bigger piece of work; this is deliberately the smallest
   * thing that makes the feature reachable at all, and it is listed as such in KNOWN_LIMITATIONS
   * rather than presented as finished.
   *
   * What the field *does* get is a specific complaint. It used to answer every mistake with one
   * sentence covering four rules at once, so somebody who typed 31 February and somebody who typed
   * yesterday both had to work out which half applied to them. `checkFutureDateTime` is shared with
   * the rest of the app and names the actual problem.
   */
  const whenProblem = checkFutureDateTime(when);
  const parsed = (() => {
    if (!when.trim() || whenProblem) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(when.trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  })();
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
      setWhen('');
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
        <TextInput
          value={when}
          onChangeText={setWhen}
          placeholder="2026-10-04 15:30"
          placeholderTextColor="#A9B8B1"
          style={styles.input}
          accessibilityLabel="New date and time, as year-month-day hours:minutes"
        />
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={side === 'CUSTOMER' ? 'Why (optional) — the professional sees this' : 'Why you need to move it — the customer sees this'}
          placeholderTextColor="#A9B8B1"
          multiline
          style={[styles.input, styles.multiline]}
          accessibilityLabel="Reason"
        />
        {whenProblem ? (
          <Text variant="micro" tone="danger">
            {whenProblem.message}
          </Text>
        ) : null}
        {reasonProblem ? (
          <Text variant="micro" tone="danger">
            {reasonProblem.message}
          </Text>
        ) : null}
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
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    fontSize: 15,
    fontFamily: typography.family.regular,
    color: palette.text,
  },
  multiline: { minHeight: 68, textAlignVertical: 'top' },
});
