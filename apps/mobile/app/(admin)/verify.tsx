import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { KycReviewItem } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useKycQueue, useMfaStatus, useOpenKycDocument, useReviewKyc } from '@/api/admin';
import { MfaGate } from '@/features/admin/MfaGate';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

export default function VerifyScreen() {
  const mfa = useMfaStatus();
  const unlocked = !!mfa.data && (mfa.data.verifiedForSession || !mfa.data.requiredForAdmin);
  const queue = useKycQueue(unlocked);

  return (
    <Screen withTabBar refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()}>
      <Text variant="title" weight="bold">
        Verification
      </Text>
      <Text variant="caption" tone="secondary">
        Longest wait first. Opening a document is recorded against you.
      </Text>
      <Spacer h={spacing.lg} />

      <MfaGate>
        {queue.isPending ? (
          <Card style={styles.card}>
            <Skeleton height={18} width="45%" />
            <Skeleton height={56} />
          </Card>
        ) : queue.isError ? (
          <ErrorState title="Could not load the queue" body="Check your connection and try again." onRetry={() => void queue.refetch()} />
        ) : queue.data.items.length === 0 ? (
          <EmptyState icon="shield-checkmark-outline" title="Nobody waiting" body="Every submission has been reviewed." />
        ) : (
          <View style={styles.list}>
            {queue.data.items.map((k, i) => (
              <Animated.View key={k.id} entering={FadeInDown.delay(i * 50).duration(320)}>
                <KycCard item={k} />
              </Animated.View>
            ))}
          </View>
        )}
      </MfaGate>
    </Screen>
  );
}

function KycCard({ item }: { item: KycReviewItem }) {
  const open = useOpenKycDocument();
  const review = useReviewKyc();
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? reviewError(e) : 'Something went wrong.');
    }
  }

  const waitingDays = Math.floor((Date.now() - new Date(item.submittedAt).getTime()) / 86_400_000);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Ionicons name="person-outline" size={18} color={palette.primaryDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {item.userName}
          </Text>
          <Text variant="micro" tone="muted">
            {item.userPhoneMasked} · {item.roles.join(', ') || 'no role'}
          </Text>
        </View>
        <Badge tone={waitingDays >= 2 ? 'danger' : 'warning'} label={waitingDays === 0 ? 'today' : `${waitingDays}d`} />
      </View>

      <View style={styles.detail}>
        <Row label="Document" value={item.documentType} />
        <Row label="Ends with" value={item.documentLast4 ?? 'not recorded'} />
      </View>

      <View style={styles.note}>
        <Ionicons name="eye-off-outline" size={14} color={palette.textMuted} />
        <Text variant="micro" tone="muted" style={{ flex: 1 }}>
          The number itself is never stored. The link below lasts five minutes and your name is
          attached to it.
        </Text>
      </View>

      {documentUrl ? (
        <Button title="Open document" size="sm" fullWidth variant="secondary" icon="document-outline" onPress={() => void Linking.openURL(documentUrl)} />
      ) : (
        <Button
          title="Request the document"
          size="sm"
          fullWidth
          variant="secondary"
          icon="lock-open-outline"
          loading={open.isPending}
          onPress={() => void run(async () => setDocumentUrl((await open.mutateAsync(item.id)).documentUrl))}
        />
      )}

      {error && (
        <Text variant="caption" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}

      {rejecting ? (
        <View style={styles.form}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What should they fix? They will see this."
            placeholderTextColor="#A9B8B1"
            multiline
            style={[styles.input, styles.multiline]}
            accessibilityLabel="Rejection reason"
          />
          <View style={styles.actions}>
            <Button title="Cancel" size="sm" variant="ghost" style={styles.action} onPress={() => setRejecting(false)} />
            <Button
              title="Send back"
              size="sm"
              style={styles.action}
              loading={review.isPending}
              onPress={() => void run(() => review.mutateAsync({ id: item.id, decision: 'REJECT', reason }))}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button title="Send back" size="sm" variant="ghost" style={styles.action} onPress={() => setRejecting(true)} />
          <Button
            title="Verify"
            size="sm"
            style={styles.action}
            icon="checkmark"
            loading={review.isPending}
            onPress={() => void run(() => review.mutateAsync({ id: item.id, decision: 'APPROVE' }))}
          />
        </View>
      )}
    </Card>
  );
}

function reviewError(e: ApiError): string {
  const first = (e.details as { admin?: string[] } | undefined)?.admin?.[0];
  switch (first) {
    case 'CANNOT_REVIEW_OWN':
      return 'You cannot review your own submission.';
    case 'ALREADY_DECIDED':
      return 'Somebody has already decided this one.';
    case 'REASON_REQUIRED':
      return 'Say what they need to fix, in a sentence.';
    default:
      return e.message;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="micro" weight="medium">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  detail: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  form: { gap: spacing.sm },
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
  multiline: { minHeight: 76, textAlignVertical: 'top' },
});
