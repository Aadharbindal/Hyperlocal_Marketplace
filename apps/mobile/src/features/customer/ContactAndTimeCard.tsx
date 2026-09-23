import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useReschedule, useStartCall } from '@/api/reach';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, Spacer, Text } from '@/ui';

/**
 * The two things a customer reaches for between booking and arrival: getting hold of their
 * professional, and moving the time.
 *
 * The call goes through a number in the middle, so neither side ends up with the other's
 * personal number - which is the point of booking through a platform at all. The screen says so
 * plainly rather than leaving people to wonder whose number they are seeing.
 */

// Kept in step with checkCanCall and checkCanReschedule in core: the server decides, this only
// decides whether to offer the button at all.
const CAN_CALL: JobStatus[] = [
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
  'DISPUTED',
];
const CAN_RESCHEDULE: JobStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'QUALIFYING',
  'OPEN_FOR_BIDS',
  'BID_RECEIVED',
  'NEGOTIATING',
  'CONFIRMED',
  'PROVIDER_ASSIGNED',
];

const CALL_MESSAGE: Record<string, string> = {
  OUTSIDE_CALLING_HOURS: 'It is outside calling hours. Send a message instead, or call if this cannot wait.',
  TOO_MANY_CALLS: 'You have called a lot today. Send a message instead.',
  COULD_NOT_CONNECT: 'We could not connect the call. Try again in a moment.',
  JOB_NOT_CONFIRMED: 'You can call once a professional is booked.',
  JOB_FINISHED: 'This booking is finished, so the line is closed.',
};

export function ContactAndTimeCard({
  jobId,
  status,
  preferredStart,
  onMessage,
}: {
  jobId: string;
  status: JobStatus;
  preferredStart: string | null;
  onMessage: () => void;
}) {
  const call = useStartCall(jobId);
  const reschedule = useReschedule(jobId);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const callable = CAN_CALL.includes(status);
  const movable = CAN_RESCHEDULE.includes(status);
  if (!callable && !movable) return null;

  async function onCall(urgent = false) {
    setError(null);
    try {
      const { call: connected } = await call.mutateAsync({ urgent });
      const dial = `tel:${connected.virtualNumber}`;
      if (await Linking.canOpenURL(dial)) await Linking.openURL(dial);
      else setError(`Dial ${connected.virtualNumber} to reach ${connected.calleeName}.`);
    } catch (e) {
      const code = e instanceof ApiError ? (e.details as { call?: string[] } | undefined)?.call?.[0] : undefined;
      if (code === 'OUTSIDE_CALLING_HOURS') {
        // Rather than simply refusing, offer the way through - the person knows whether their
        // own situation is urgent, and we do not.
        Alert.alert('Outside calling hours', CALL_MESSAGE.OUTSIDE_CALLING_HOURS, [
          { text: 'Send a message', onPress: onMessage },
          { text: 'It is urgent', onPress: () => void onCall(true) },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
      setError((code && CALL_MESSAGE[code]) ?? 'We could not connect the call.');
    }
  }

  async function onPick(newStart: Date) {
    setPicking(false);
    setError(null);
    try {
      await reschedule.mutateAsync({ newStart: newStart.toISOString() });
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { message?: string } | undefined) : undefined;
      setError(details?.message ?? 'We could not move this booking.');
    }
  }

  return (
    <Card style={styles.card}>
      <Text weight="semibold" style={styles.title}>
        Get in touch
      </Text>

      <View style={styles.actions}>
        {callable ? (
          <Button
            title="Call"
            variant="secondary"
            size="md"
            icon="call-outline"
            style={styles.action}
            loading={call.isPending}
            onPress={() => void onCall()}
          />
        ) : null}
        <Button title="Message" variant="secondary" size="md" icon="chatbubble-ellipses-outline" style={styles.action} onPress={onMessage} />
      </View>

      {callable ? (
        <View style={styles.note}>
          <Ionicons name="shield-checkmark-outline" size={14} color={palette.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            Calls go through a number we provide. Neither of you sees the other&apos;s personal number.
          </Text>
        </View>
      ) : null}

      {movable ? (
        <>
          <Spacer h={spacing.sm} />
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" style={styles.timeRow}>
            <Ionicons name="calendar-outline" size={18} color={palette.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="micro" tone="muted">
                {preferredStart ? 'Scheduled for' : 'No time set'}
              </Text>
              <Text variant="label" weight="semibold">
                {preferredStart
                  ? new Date(preferredStart).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
                  : 'Pick a time that suits you'}
              </Text>
            </View>
            <Text variant="micro" style={{ color: palette.primary }}>
              Change
            </Text>
          </Pressable>
        </>
      ) : null}

      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}

      <TimePicker visible={picking} onClose={() => setPicking(false)} onPick={(d) => void onPick(d)} busy={reschedule.isPending} />
    </Card>
  );
}

/**
 * A short list of real slots rather than a raw date wheel. Somebody rebooking a plumber is
 * choosing between "tomorrow morning" and "Saturday afternoon", not entering a timestamp.
 */
function TimePicker({
  visible,
  onClose,
  onPick,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (d: Date) => void;
  busy: boolean;
}) {
  const slots = nextSlots();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          When suits you?
        </Text>
        <Text variant="micro" tone="muted">
          We will let your professional know. A booking can be moved twice.
        </Text>
        <Spacer h={spacing.md} />
        {slots.map((slot) => (
          <Pressable
            key={slot.at.toISOString()}
            onPress={() => onPick(slot.at)}
            disabled={busy}
            accessibilityRole="button"
            style={styles.slot}
          >
            <Text variant="label" weight="semibold">
              {slot.day}
            </Text>
            <Text variant="caption" tone="secondary">
              {slot.time}
            </Text>
          </Pressable>
        ))}
        <Spacer h={spacing.sm} />
        <Button title="Not now" variant="ghost" fullWidth onPress={onClose} />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

/** The next few sensible visiting slots: mornings, afternoons and evenings over the coming days. */
function nextSlots(): Array<{ at: Date; day: string; time: string }> {
  const out: Array<{ at: Date; day: string; time: string }> = [];
  const hours = [
    { h: 9, label: 'Morning, 9–11 am' },
    { h: 14, label: 'Afternoon, 2–4 pm' },
    { h: 18, label: 'Evening, 6–8 pm' },
  ];
  const now = new Date();
  for (let day = 0; day < 4 && out.length < 8; day++) {
    for (const slot of hours) {
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(slot.h, 0, 0, 0);
      // A slot that has already passed today is not an option.
      if (at.getTime() <= now.getTime() + 60 * 60_000) continue;
      out.push({
        at,
        day: day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : at.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }),
        time: slot.label,
      });
      if (out.length >= 8) break;
    }
  }
  return out;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#F6FBF9',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF4F2',
  },
});
