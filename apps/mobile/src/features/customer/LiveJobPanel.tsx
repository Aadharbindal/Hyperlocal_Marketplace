import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type JobStatus, type PriceRevisionView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useApproveCompletion, useExecution, useRespondToRevision } from '@/api/execution';
import { ChatSheet } from '@/features/shared/ChatSheet';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

const LIVE: JobStatus[] = [
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
];

/**
 * Everything the customer does while a booking is running: the start code, the approval of
 * any extra work, the completion sign-off and the chat.
 */
export function LiveJobPanel({ jobId, status }: { jobId: string; status: JobStatus }) {
  const enabled = LIVE.includes(status);
  const panel = useExecution(jobId, enabled);
  const [chatOpen, setChatOpen] = useState(false);
  if (!enabled || !panel.data) return null;

  const { startCode, technician, openRevision, completion, chatUnread } = panel.data;
  const waitingToStart = !!startCode && (status === 'PROVIDER_ASSIGNED' || status === 'EN_ROUTE' || status === 'ARRIVED');

  return (
    <View style={styles.wrap}>
      {waitingToStart && <StartCodeCard code={startCode} arrived={status === 'ARRIVED'} />}

      {technician && (
        <Animated.View entering={FadeInDown.duration(320)}>
          <Card style={styles.row}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={18} color={palette.primaryDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text variant="label" weight="semibold">
                  {technician.name}
                </Text>
                {technician.verified && <Ionicons name="shield-checkmark" size={14} color={palette.primary} />}
              </View>
              <Text variant="micro" tone="muted">
                Technician on this job{technician.maskedPhone ? ` · ${technician.maskedPhone}` : ''}
              </Text>
            </View>
          </Card>
        </Animated.View>
      )}

      {openRevision && <RevisionCard jobId={jobId} revision={openRevision} />}

      {status === 'CUSTOMER_APPROVAL_PENDING' && completion && <ApprovalCard jobId={jobId} summary={completion.summary} warranty={completion.warrantyNote} />}

      <Pressable accessibilityRole="button" onPress={() => setChatOpen(true)} style={styles.chatBtn}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={palette.primaryDeep} />
        <Text weight="semibold" tone="primary" style={{ flex: 1 }}>
          Message the provider
        </Text>
        {chatUnread > 0 && <Badge tone="danger" label={String(chatUnread)} />}
      </Pressable>

      <ChatSheet jobId={jobId} visible={chatOpen} onClose={() => setChatOpen(false)} />
    </View>
  );
}

/** The code is the customer's proof of presence: it is never sent to the provider. */
function StartCodeCard({ code, arrived }: { code: string; arrived: boolean }) {
  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <Card style={styles.codeCard}>
        <Text variant="micro" tone="muted">
          {arrived ? 'Your provider has arrived' : 'Start code'}
        </Text>
        <View style={styles.digits}>
          {code.split('').map((d, i) => (
            <View key={i} style={styles.digit}>
              <Text weight="extrabold" style={styles.digitText}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" tone="secondary" center>
          Share this only when the work is about to begin. Nobody can start the job without it.
        </Text>
      </Card>
    </Animated.View>
  );
}

/** Extra work, priced and explained, with nothing charged until this is approved. */
function RevisionCard({ jobId, revision }: { jobId: string; revision: PriceRevisionView }) {
  const respond = useRespondToRevision();
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'APPROVE' | 'REJECT') {
    setError(null);
    try {
      await respond.mutateAsync({ jobId, revisionId: revision.id, action });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <Card style={styles.revision}>
        <View style={styles.rowHead}>
          <View style={styles.warnIcon}>
            <Ionicons name="alert-circle" size={18} color="#B26A00" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="semibold">
              Your approval is needed
            </Text>
            <Text variant="micro" tone="muted">
              The provider found extra work
            </Text>
          </View>
        </View>

        <Text variant="caption" tone="secondary">
          “{revision.explanation}”
        </Text>

        <View style={styles.amounts}>
          <Line label="Agreed price" value={formatInr(revision.originalTotalPaise)} />
          {revision.extraLabourPaise > 0 && <Line label="Extra labour" value={`+ ${formatInr(revision.extraLabourPaise)}`} />}
          {revision.extraMaterialPaise > 0 && <Line label="Extra material" value={`+ ${formatInr(revision.extraMaterialPaise)}`} />}
          {revision.extraTimeMinutes > 0 && <Line label="Extra time" value={`${revision.extraTimeMinutes} min`} />}
          <View style={styles.divider} />
          <Line label="New total" value={formatInr(revision.revisedTotalPaise)} bold />
          <Line label="You authorize now" value={formatInr(revision.differencePaise)} bold />
        </View>

        {revision.needsSupport && (
          <View style={styles.assurance}>
            <Ionicons name="help-buoy-outline" size={14} color={palette.danger} />
            <Text variant="micro" style={{ color: palette.danger, flex: 1 }}>
              This is a big jump from the agreed price. Talk to support before approving.
            </Text>
          </View>
        )}

        {error && (
          <Animated.View entering={FadeIn.duration(200)}>
            <Text variant="caption" style={{ color: palette.danger }}>
              {error}
            </Text>
          </Animated.View>
        )}

        <View style={styles.actions}>
          <Button title="Not now" size="sm" variant="ghost" style={styles.action} loading={respond.isPending} onPress={() => act('REJECT')} />
          <Button title="Approve extra" size="sm" style={styles.action} loading={respond.isPending} onPress={() => act('APPROVE')} />
        </View>
        <Text variant="micro" tone="muted" center>
          Declining keeps the original agreed price.
        </Text>
      </Card>
    </Animated.View>
  );
}

function ApprovalCard({ jobId, summary, warranty }: { jobId: string; summary: string; warranty: string | null }) {
  const approve = useApproveCompletion();
  const [error, setError] = useState<string | null>(null);

  async function act(approved: boolean) {
    setError(null);
    try {
      await approve.mutateAsync({
        jobId,
        approved,
        reason: approved ? undefined : 'The work is not finished yet',
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <Card style={styles.revision}>
        <View style={styles.rowHead}>
          <View style={styles.doneIcon}>
            <Ionicons name="checkmark-done" size={18} color={palette.primaryDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="semibold">
              Work finished — please check
            </Text>
            <Text variant="micro" tone="muted">
              Approve only when you are happy with it
            </Text>
          </View>
        </View>
        <Text variant="caption" tone="secondary">
          “{summary}”
        </Text>
        {warranty ? <Badge tone="success" icon="shield-outline" label={warranty} /> : null}
        {error && (
          <Text variant="caption" style={{ color: palette.danger }}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Button title="Not finished" size="sm" variant="ghost" style={styles.action} loading={approve.isPending} onPress={() => act(false)} />
          <Button title="Approve" size="sm" icon="checkmark" style={styles.action} loading={approve.isPending} onPress={() => act(true)} />
        </View>
      </Card>
    </Animated.View>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant="caption" tone={bold ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant="caption" weight={bold ? 'bold' : 'medium'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },

  codeCard: { alignItems: 'center', gap: spacing.md },
  digits: { flexDirection: 'row', gap: spacing.sm },
  digit: { width: 52, height: 62, borderRadius: radius.md, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  digitText: { fontSize: 30, lineHeight: 38, color: palette.primaryDeep },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  revision: { gap: spacing.md, borderWidth: 2, borderColor: palette.primary },
  warnIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF1D6', alignItems: 'center', justifyContent: 'center' },
  doneIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  amounts: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },

  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
});
