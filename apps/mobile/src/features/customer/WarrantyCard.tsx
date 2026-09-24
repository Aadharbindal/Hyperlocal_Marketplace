import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { WarrantyClaimView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useBookRevisit, useRaiseWarrantyClaim, useResolveClaim, useWarrantyStatus } from '@/api/warranty';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Spacer, Text, TextField } from '@/ui';

/**
 * The warranty on a finished job.
 *
 * This is the card that makes booking through the platform worth doing. Until it existed, a
 * customer whose tap leaked again had no button and rang the professional directly - and both of
 * them learnt they never needed us. So it is deliberately prominent on a finished job rather
 * than filed away under "help".
 */

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'primary' }> = {
  OPEN: { label: 'waiting on your professional', tone: 'warning' },
  ACCEPTED: { label: 'they are coming back', tone: 'success' },
  DECLINED: { label: 'they say it is not covered', tone: 'danger' },
  REVISIT_BOOKED: { label: 'return visit booked', tone: 'primary' },
  RESOLVED: { label: 'sorted', tone: 'success' },
  ESCALATED: { label: 'our team is handling it', tone: 'primary' },
  EXPIRED: { label: 'cover ended', tone: 'neutral' },
};

export function WarrantyCard({ jobId, finished }: { jobId: string; finished: boolean }) {
  const status = useWarrantyStatus(jobId, finished);
  const [claiming, setClaiming] = useState(false);

  // Nothing to say on a job that is not finished, or one that never carried a warranty.
  if (!finished || !status.data || status.data.warrantyDays <= 0) return null;
  const { claim } = status.data;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="shield-checkmark" size={20} color={status.data.active ? palette.primary : palette.textMuted} />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="bold">
            {status.data.warrantyDays}-day warranty
          </Text>
          <Text variant="micro" tone="muted">
            {status.data.active
              ? `${status.data.daysLeft} ${status.data.daysLeft === 1 ? 'day' : 'days'} of cover left`
              : 'This cover has ended'}
          </Text>
        </View>
        {claim ? <Badge tone={STATUS[claim.status]?.tone ?? 'neutral'} label={STATUS[claim.status]?.label ?? claim.status} /> : null}
      </View>

      {claim ? <ClaimDetail claim={claim} /> : null}

      {!claim && status.data.canClaim ? (
        <>
          <Text variant="micro" tone="muted">
            If the same problem comes back while you are covered, your professional returns at no
            charge.
          </Text>
          <Button title="Something has gone wrong again" size="sm" variant="secondary" icon="build-outline" onPress={() => setClaiming(true)} />
        </>
      ) : null}

      {!claim && !status.data.canClaim && status.data.reason ? (
        <Text variant="micro" tone="muted">
          {status.data.reason}
        </Text>
      ) : null}

      <ClaimSheet visible={claiming} jobId={jobId} onClose={() => setClaiming(false)} />
    </Card>
  );
}

function ClaimDetail({ claim }: { claim: WarrantyClaimView }) {
  const revisit = useBookRevisit();
  const resolve = useResolveClaim();
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.detail}>
      <Text variant="micro" tone="muted">
        {claim.description}
      </Text>

      {claim.status === 'DECLINED' && claim.declineReason ? (
        <View style={styles.quote}>
          <Text variant="micro" tone="secondary">
            &ldquo;{claim.declineReason}&rdquo;
          </Text>
          <Text variant="micro" tone="muted">
            If you disagree, raise a dispute and our team will look at it.
          </Text>
        </View>
      ) : null}

      {/* Said out loud, because it is the whole promise. */}
      {claim.status === 'ACCEPTED' ? (
        <>
          <Text variant="micro" style={{ color: palette.primary }}>
            The return visit is free of charge.
          </Text>
          <Button
            title="Book the return visit"
            size="sm"
            loading={revisit.isPending}
            onPress={() => {
              setError(null);
              revisit.mutate({ claimId: claim.id }, { onError: () => setError('Could not book that. Try again.') });
            }}
          />
        </>
      ) : null}

      {claim.status === 'REVISIT_BOOKED' ? (
        <Button
          title="It is sorted now"
          size="sm"
          variant="secondary"
          loading={resolve.isPending}
          onPress={() => resolve.mutate({ claimId: claim.id, note: 'Fixed on the return visit' })}
        />
      ) : null}

      {claim.awaitingSupport ? (
        <Text variant="micro" tone="muted">
          Your professional has not answered in time, so our team is stepping in.
        </Text>
      ) : null}

      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ClaimSheet({ visible, jobId, onClose }: { visible: boolean; jobId: string; onClose: () => void }) {
  const raise = useRaiseWarrantyClaim(jobId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await raise.mutateAsync({ description: text.trim() });
      setText('');
      onClose();
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { message?: string } | undefined) : undefined;
      setError(details?.message ?? 'We could not raise that claim. Try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          What has gone wrong?
        </Text>
        <Text variant="micro" tone="muted">
          Describe it the way you would to the person who did the work. They have 48 hours to
          answer, and our team steps in if they do not.
        </Text>
        <Spacer h={spacing.md} />
        <TextField
          value={text}
          onChangeText={setText}
          placeholder="The same tap started dripping again three days later…"
          multiline
          numberOfLines={4}
          style={styles.input}
        />
        <Text variant="micro" tone="muted">
          {text.trim().length < 20 ? `${20 - text.trim().length} more characters` : ' '}
        </Text>
        {error ? (
          <Text variant="micro" style={{ color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <Spacer h={spacing.sm} />
        <Button title="Raise the claim" fullWidth loading={raise.isPending} disabled={text.trim().length < 20} onPress={() => void submit()} />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, borderWidth: 1, borderColor: '#DCEFE8' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detail: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#EEF4F2', paddingTop: spacing.sm },
  quote: { gap: 2, backgroundColor: '#F6FBF9', borderRadius: radius.sm, padding: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  input: { minHeight: 96, textAlignVertical: 'top' },
});
