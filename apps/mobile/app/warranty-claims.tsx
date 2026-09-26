import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { WarrantyClaimView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useBookRevisit, useRespondToClaim, useWarrantyClaims } from '@/api/warranty';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

/**
 * Warranty claims against this professional's work.
 *
 * This screen is the other half of a promise the app was already making. The claim API, the
 * 48-hour clock and the escalation to support all existed, and the only thing a professional
 * could do about a claim was fail to answer it - which is a strange way to treat somebody whose
 * reputation is on the line.
 *
 * Declining is offered as plainly as accepting. Not everything that breaks a week later is the
 * same fault, and a screen that only offers "accept" would make honest professionals either eat
 * the cost or ignore the claim.
 */

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'primary' }> = {
  OPEN: { label: 'needs your answer', tone: 'warning' },
  ACCEPTED: { label: 'you agreed to return', tone: 'success' },
  DECLINED: { label: 'you declined', tone: 'neutral' },
  REVISIT_BOOKED: { label: 'return visit booked', tone: 'primary' },
  RESOLVED: { label: 'sorted', tone: 'success' },
  ESCALATED: { label: 'with our team', tone: 'danger' },
  EXPIRED: { label: 'cover ended', tone: 'neutral' },
};

/** How long is left of the 48 hours, which is the thing a professional needs to see first. */
function hoursLeft(createdAt: string): number {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.ceil((48 * 3600_000 - elapsed) / 3600_000));
}

export default function WarrantyClaimsScreen() {
  const router = useRouter();
  const claims = useWarrantyClaims();
  const [declining, setDeclining] = useState<WarrantyClaimView | null>(null);

  // Anything still waiting on this professional goes to the top: it is the only part of the
  // list with a deadline attached.
  const ordered = [...(claims.data ?? [])].sort(
    (a, b) => Number(b.status === 'OPEN') - Number(a.status === 'OPEN') || b.createdAt.localeCompare(a.createdAt),
  );
  const waiting = ordered.filter((c) => c.status === 'OPEN').length;

  return (
    <Screen refreshing={claims.isRefetching} onRefresh={() => void claims.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="title" weight="bold">
            Warranty claims
          </Text>
          <Text variant="caption" tone="secondary">
            {waiting > 0 ? `${waiting} waiting on you` : 'Work customers say has come back'}
          </Text>
        </View>
      </View>
      <Spacer h={spacing.lg} />

      {claims.isPending ? (
        <View style={styles.list}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : claims.isError ? (
        <ErrorState title="Could not load your claims" body="Check your connection and try again." onRetry={() => void claims.refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="No claims"
          body="If a customer says something you fixed has come back, it appears here with 48 hours to answer."
        />
      ) : (
        <View style={styles.list}>
          {ordered.map((claim, i) => (
            <Animated.View key={claim.id} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <ClaimCard claim={claim} onDecline={() => setDeclining(claim)} />
            </Animated.View>
          ))}
        </View>
      )}

      <DeclineSheet claim={declining} onClose={() => setDeclining(null)} />
    </Screen>
  );
}

function ClaimCard({ claim, onDecline }: { claim: WarrantyClaimView; onDecline: () => void }) {
  const respond = useRespondToClaim();
  const revisit = useBookRevisit();
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS[claim.status] ?? { label: claim.status.toLowerCase(), tone: 'neutral' as const };
  const left = hoursLeft(claim.createdAt);

  return (
    <Card style={[styles.card, claim.status === 'OPEN' && styles.cardOpen]}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold">
            {claim.categoryName}
          </Text>
          <Text variant="micro" tone="muted">
            {claim.warrantyDays}-day warranty ·{' '}
            {new Date(claim.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
        <Badge tone={meta.tone} label={meta.label} />
      </View>

      <Text variant="caption" tone="secondary">
        {claim.description}
      </Text>

      {claim.status === 'OPEN' ? (
        <>
          {/* The clock, said plainly. After it runs out the claim goes to support and the
              professional loses the chance to sort it themselves. */}
          <View style={[styles.clock, left <= 12 && styles.clockUrgent]}>
            <Ionicons name="time-outline" size={14} color={left <= 12 ? '#B26A00' : palette.textMuted} />
            <Text variant="micro" style={{ color: left <= 12 ? '#7A5200' : palette.textMuted }}>
              {left > 0
                ? `${left} ${left === 1 ? 'hour' : 'hours'} to answer before our team takes it over`
                : 'Time is up - our team is taking this over'}
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              title="Not covered"
              size="sm"
              variant="secondary"
              style={styles.action}
              onPress={onDecline}
            />
            <Button
              title="I will come back"
              size="sm"
              style={styles.action}
              loading={respond.isPending}
              onPress={() => {
                setError(null);
                respond.mutate(
                  { claimId: claim.id, response: 'ACCEPT' },
                  { onError: () => setError('Could not send that. Try again.') },
                );
              }}
            />
          </View>
          <Text variant="micro" tone="muted">
            A return visit under warranty is free of charge - you agreed to it when you offered
            the warranty.
          </Text>
        </>
      ) : null}

      {claim.status === 'ACCEPTED' ? (
        <Button
          title="Book the return visit"
          size="sm"
          variant="secondary"
          loading={revisit.isPending}
          onPress={() => revisit.mutate({ claimId: claim.id })}
        />
      ) : null}

      {claim.status === 'DECLINED' && claim.declineReason ? (
        <View style={styles.quote}>
          <Text variant="micro" tone="muted">
            You said: &ldquo;{claim.declineReason}&rdquo;
          </Text>
        </View>
      ) : null}

      {claim.status === 'ESCALATED' ? (
        <Text variant="micro" tone="muted">
          This went past the answer window, so our team is deciding on the customer&apos;s behalf.
        </Text>
      ) : null}

      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Declining needs a reason - the server refuses without twenty characters, and more to the
 * point the customer is owed an explanation and support will need one if this goes further.
 */
function DeclineSheet({ claim, onClose }: { claim: WarrantyClaimView | null; onClose: () => void }) {
  const respond = useRespondToClaim();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!claim) return;
    setError(null);
    try {
      await respond.mutateAsync({ claimId: claim.id, response: 'DECLINE', reason: reason.trim() });
      setReason('');
      onClose();
    } catch (e) {
      const which = e instanceof ApiError ? (e.details as { warranty?: string[] } | undefined)?.warranty?.[0] : undefined;
      setError(which === 'REASON_REQUIRED' ? 'Please explain a little more.' : 'Could not send that. Try again.');
    }
  }

  return (
    <Modal visible={!!claim} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          Why is this not covered?
        </Text>
        <Text variant="micro" tone="muted">
          The customer sees this, and our team reads it if they disagree. Be specific - &ldquo;a
          different pipe, upstream of the joint I replaced&rdquo; settles it; &ldquo;not my
          fault&rdquo; does not.
        </Text>
        <Spacer h={spacing.md} />
        <TextField
          value={reason}
          onChangeText={setReason}
          placeholder="The new leak is on a different pipe…"
          multiline
          numberOfLines={4}
          style={styles.input}
        />
        <Text variant="micro" tone="muted">
          {reason.trim().length < 20 ? `${20 - reason.trim().length} more characters` : ' '}
        </Text>
        {error ? (
          <Text variant="micro" style={{ color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <Spacer h={spacing.sm} />
        <Button
          title="Send this answer"
          fullWidth
          loading={respond.isPending}
          disabled={reason.trim().length < 20}
          onPress={() => void submit()}
        />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  cardOpen: { borderWidth: 1, borderColor: '#F0C26A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F6FBF9', borderRadius: radius.sm, padding: spacing.sm },
  clockUrgent: { backgroundColor: '#FFF6E5' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  quote: { backgroundColor: '#F6FBF9', borderRadius: radius.sm, padding: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  input: { minHeight: 96, textAlignVertical: 'top' },
});
