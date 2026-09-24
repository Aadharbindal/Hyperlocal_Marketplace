import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type JobStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { askForPhoto } from '@/features/capture/media';
import { useAddEvidence, useCompleteJob, useExecution, useProgress, useRequestRevision, useStartJob } from '@/api/execution';
import { ChatSheet } from '@/features/shared/ChatSheet';
import { MaterialRequestForm } from '@/features/provider/MaterialRequestForm';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

/**
 * The provider's controls for a confirmed job: on the way, arrived, the start code, asking
 * for approval of extra work, and handing the work back for the customer to check.
 */
export function JobRunner({ jobId, status, categoryName }: { jobId: string; status: JobStatus; categoryName: string }) {
  const panel = useExecution(jobId, true);
  const progress = useProgress();
  const [chatOpen, setChatOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: 'EN_ROUTE' | 'ARRIVED') {
    setError(null);
    try {
      await progress.mutateAsync({ jobId, to });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the job.');
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text variant="label" weight="semibold" style={{ flex: 1 }}>
          {categoryName}
        </Text>
        <Badge tone="primary" label={LABEL[status] ?? status.toLowerCase()} />
      </View>

      {error && (
        <Animated.View entering={FadeIn.duration(180)}>
          <Text variant="caption" style={{ color: palette.danger }}>
            {error}
          </Text>
        </Animated.View>
      )}

      {status === 'PROVIDER_ASSIGNED' && (
        <Button title="I'm on my way" icon="navigate" fullWidth loading={progress.isPending} onPress={() => move('EN_ROUTE')} />
      )}
      {status === 'EN_ROUTE' && (
        <Button title="I've arrived" icon="location" fullWidth loading={progress.isPending} onPress={() => move('ARRIVED')} />
      )}
      {status === 'ARRIVED' && <StartCodeEntry jobId={jobId} attemptsLeft={panel.data?.startCodeAttemptsLeft ?? null} />}
      {status === 'IN_PROGRESS' && <InProgressActions jobId={jobId} />}
      {status === 'PRICE_REVISION_PENDING' && panel.data?.openRevision && (
        <View style={styles.waiting}>
          <Ionicons name="hourglass-outline" size={16} color={palette.textMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Waiting for the customer to approve {formatInr(panel.data.openRevision.differencePaise)} of extra work.
          </Text>
        </View>
      )}
      {status === 'CUSTOMER_APPROVAL_PENDING' && (
        <View style={styles.waiting}>
          <Ionicons name="checkmark-done-outline" size={16} color={palette.textMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Sent to the customer for approval.
          </Text>
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={() => setChatOpen(true)} style={styles.chatBtn}>
        <Ionicons name="chatbubble-ellipses-outline" size={17} color={palette.primaryDeep} />
        <Text variant="caption" weight="semibold" tone="primary" style={{ flex: 1 }}>
          Message the customer
        </Text>
        {(panel.data?.chatUnread ?? 0) > 0 && <Badge tone="danger" label={String(panel.data?.chatUnread)} />}
      </Pressable>

      <ChatSheet jobId={jobId} visible={chatOpen} onClose={() => setChatOpen(false)} />
    </Card>
  );
}

const LABEL: Partial<Record<JobStatus, string>> = {
  PROVIDER_ASSIGNED: 'confirmed',
  EN_ROUTE: 'on the way',
  ARRIVED: 'at the door',
  IN_PROGRESS: 'working',
  PRICE_REVISION_PENDING: 'awaiting approval',
  CUSTOMER_APPROVAL_PENDING: 'awaiting sign-off',
};

/** The customer reads the four digits out; nothing starts without them. */
function StartCodeEntry({ jobId, attemptsLeft }: { jobId: string; attemptsLeft: number | null }) {
  const start = useStartJob();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await start.mutateAsync({ jobId, code });
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError ? startError(e) : 'Could not start the job.');
    }
  }

  return (
    <Animated.View entering={FadeInDown.duration(280)} style={styles.codeBlock}>
      <Text variant="caption" tone="secondary">
        Ask the customer for their 4-digit start code.
      </Text>
      <View style={styles.codeRow}>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="0000"
          placeholderTextColor="#A9B8B1"
          style={styles.codeInput}
          accessibilityLabel="Start code"
        />
        <Button title="Start work" style={{ flex: 1 }} loading={start.isPending} onPress={submit} />
      </View>
      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : attemptsLeft !== null && attemptsLeft < 5 ? (
        <Text variant="micro" tone="muted">
          {attemptsLeft} attempts left
        </Text>
      ) : null}
    </Animated.View>
  );
}

function startError(e: ApiError): string {
  const first = (e.details as { execution?: string[] } | undefined)?.execution?.[0];
  const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
  switch (first) {
    case 'WRONG_CODE':
      return `That code is wrong. ${left ?? 0} attempts left.`;
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong attempts. Contact support to start this job.';
    case 'CODE_EXPIRED':
      return 'This code has expired. Contact support.';
    case 'JOB_NOT_ARRIVED':
      return 'Mark yourself as arrived first.';
    default:
      return e.message;
  }
}

/** While working: ask for approval of extra work, or hand it back for checking. */
function InProgressActions({ jobId }: { jobId: string }) {
  const evidence = useAddEvidence();
  const revision = useRequestRevision();
  const complete = useCompleteJob();
  const [mode, setMode] = useState<'none' | 'revision' | 'complete' | 'materials'>('none');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Both flows need at least one photo, and it has to be a real one. Extra work that costs the
   * customer more, and a job marked done, are exactly the two moments where "there is a photo"
   * has to mean a photo somebody actually took.
   */
  function withPhoto(run: (mediaId: string) => Promise<unknown>) {
    setError(null);
    askForPhoto(
      (file) => {
        void (async () => {
          try {
            const shot = await evidence.mutateAsync({ jobId, file });
            await run(shot.media.id);
            setMode('none');
            setAmount('');
            setText('');
          } catch (e) {
            setError(e instanceof ApiError ? revisionError(e) : 'Something went wrong.');
          }
        })();
      },
      setError,
    );
  }

  if (mode === 'none') {
    return (
      <View style={styles.stack}>
        <Button title="Need materials" size="sm" variant="secondary" fullWidth icon="cube-outline" onPress={() => setMode('materials')} />
        <View style={styles.actions}>
          <Button title="Extra work" size="sm" variant="secondary" style={styles.action} icon="add-circle-outline" onPress={() => setMode('revision')} />
          <Button title="Mark done" size="sm" style={styles.action} icon="checkmark" onPress={() => setMode('complete')} />
        </View>
      </View>
    );
  }

  if (mode === 'materials') return <MaterialRequestForm jobId={jobId} onDone={() => setMode('none')} />;

  const isRevision = mode === 'revision';
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.form}>
      <Text variant="caption" weight="semibold">
        {isRevision ? 'Ask for approval of extra work' : 'Hand the job back for checking'}
      </Text>
      {isRevision && (
        <TextInput
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="Extra labour in rupees"
          placeholderTextColor="#A9B8B1"
          style={styles.input}
          accessibilityLabel="Extra labour in rupees"
        />
      )}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={isRevision ? 'Explain what you found and why it costs more' : 'What did you do?'}
        placeholderTextColor="#A9B8B1"
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel={isRevision ? 'Explanation' : 'Summary'}
      />
      {error && (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <Button title="Cancel" size="sm" variant="ghost" style={styles.action} onPress={() => setMode('none')} />
        <Button
          title={isRevision ? 'Send for approval' : 'Submit'}
          size="sm"
          style={styles.action}
          loading={evidence.isPending || revision.isPending || complete.isPending}
          onPress={() =>
            withPhoto((mediaId) =>
              isRevision
                ? revision.mutateAsync({
                    jobId,
                    reason: 'EXTRA_WORK',
                    extraLabourPaise: Number(amount || 0) * 100,
                    explanation: text,
                    mediaIds: [mediaId],
                  })
                : complete.mutateAsync({ jobId, summary: text, mediaIds: [mediaId] }),
            )
          }
        />
      </View>
      <Text variant="micro" tone="muted">
        A photo is attached automatically — the customer always sees why.
      </Text>
    </Animated.View>
  );
}

function revisionError(e: ApiError): string {
  const first = (e.details as { execution?: string[] } | undefined)?.execution?.[0];
  switch (first) {
    case 'EXPLANATION_TOO_SHORT':
      return 'Explain it in a bit more detail (at least 20 characters).';
    case 'SUMMARY_TOO_SHORT':
      return 'Write a short summary of what you did.';
    case 'NOTHING_EXTRA':
      return 'Enter the extra amount you need approved.';
    case 'REVISION_ALREADY_OPEN':
      return 'The customer is still answering your last request.';
    case 'REVISION_LIMIT_REACHED':
      return 'You have already asked three times on this job.';
    case 'PHOTOS_REQUIRED':
      return 'A photo is required.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, borderWidth: 2, borderColor: palette.primary },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  codeBlock: { gap: spacing.sm },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codeInput: {
    width: 104,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    textAlign: 'center',
    fontSize: 22,
    letterSpacing: 6,
    fontFamily: typography.family.bold,
    color: palette.text,
  },

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
  multiline: { minHeight: 72, textAlignVertical: 'top' },

  stack: { gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 42,
  },
});
