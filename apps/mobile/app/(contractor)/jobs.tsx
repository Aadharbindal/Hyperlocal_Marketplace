import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ContractorJobItem, TechnicianView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAssignTechnician, useContractorJobs, useTeam } from '@/api/contractor';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * What the crew is doing today.
 *
 * Jobs with nobody on them come first and say so loudly, because that is the one thing on this
 * screen with a deadline attached: a customer is expecting somebody, and until a technician is
 * assigned, nobody is coming.
 */
export default function ContractorJobsScreen() {
  const t = useStrings();
  const router = useRouter();
  const jobs = useContractorJobs();
  const team = useTeam();
  const [assigning, setAssigning] = useState<ContractorJobItem | null>(null);

  // Unassigned first, then by when they are due.
  const ordered = [...(jobs.data ?? [])].sort(
    (a, b) =>
      Number(b.needsTechnician) - Number(a.needsTechnician) ||
      (a.preferredStart ?? '9999').localeCompare(b.preferredStart ?? '9999'),
  );
  const waiting = ordered.filter((j) => j.needsTechnician).length;

  return (
    <Screen withTabBar refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title" weight="bold">
            {t('tabs.jobs')}
          </Text>
          <Text variant="caption" tone="secondary">
            {waiting > 0 ? `${waiting} waiting for someone` : 'Your crew’s work'}
          </Text>
        </View>
      </View>
      <Spacer h={spacing.lg} />

      {jobs.isPending ? (
        <View style={styles.list}>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      ) : jobs.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void jobs.refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon="briefcase-outline"
          title="No live jobs"
          body="Jobs you win appear here. Send offers from the provider view to start winning them."
        />
      ) : (
        <View style={styles.list}>
          {ordered.map((job, i) => (
            <Animated.View key={job.jobId} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <Card style={[styles.card, job.needsTechnician && styles.cardWaiting]}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" weight="bold">
                      {job.categoryName}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {job.areaLabel}
                      {job.preferredStart
                        ? ` · ${new Date(job.preferredStart).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
                        : ''}
                    </Text>
                  </View>
                  <Badge tone={job.needsTechnician ? 'warning' : 'success'} label={job.status.replace(/_/g, ' ').toLowerCase()} />
                </View>

                <View style={styles.assignRow}>
                  <Ionicons name={job.technician ? 'person' : 'person-outline'} size={16} color={palette.textMuted} />
                  <Text variant="micro" tone={job.technician ? 'secondary' : 'muted'} style={{ flex: 1 }}>
                    {job.technician ? job.technician.fullName : 'Nobody assigned yet'}
                  </Text>
                  <Button
                    title={job.technician ? 'Change' : 'Assign'}
                    size="sm"
                    variant={job.needsTechnician ? 'primary' : 'secondary'}
                    onPress={() => setAssigning(job)}
                  />
                </View>

                <Pressable onPress={() => router.push(`/(provider)/active`)} accessibilityRole="button" style={styles.open}>
                  <Text variant="micro" style={{ color: palette.primary }}>
                    Open job
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={palette.primary} />
                </Pressable>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      <AssignSheet job={assigning} team={team.data ?? []} onClose={() => setAssigning(null)} />
    </Screen>
  );
}

function AssignSheet({ job, team, onClose }: { job: ContractorJobItem | null; team: TechnicianView[]; onClose: () => void }) {
  const assign = useAssignTechnician();
  const [error, setError] = useState<string | null>(null);

  // Only verified people can go: the server refuses anyone else, and finding that out after
  // choosing somebody would waste the contractor's time.
  const eligible = team.filter((p) => p.verificationStatus === 'VERIFIED' && p.active);

  return (
    <Modal visible={!!job} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          Who is going?
        </Text>
        <Spacer h={spacing.sm} />

        {eligible.length === 0 ? (
          <Text variant="caption" tone="muted">
            Nobody on your crew is verified yet. Submit their documents from the Team tab - an
            unverified person cannot be sent to a customer.
          </Text>
        ) : (
          eligible.map((person) => (
            <Pressable
              key={person.userId}
              accessibilityRole="button"
              disabled={assign.isPending}
              onPress={() => {
                if (!job) return;
                setError(null);
                assign.mutate(
                  { jobId: job.jobId, technicianId: person.userId },
                  {
                    onSuccess: onClose,
                    onError: (e) =>
                      setError(e instanceof ApiError ? e.message : 'Could not assign them. Try again.'),
                  },
                );
              }}
              style={styles.person}
            >
              <View style={styles.avatar}>
                <Text weight="bold" style={{ color: palette.primary }}>
                  {person.fullName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text variant="label" weight="semibold" style={{ flex: 1 }}>
                {person.fullName}
              </Text>
              {job?.technician?.userId === person.userId ? (
                <Ionicons name="checkmark-circle" size={20} color={palette.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
              )}
            </Pressable>
          ))
        )}

        {error ? (
          <Text variant="micro" style={{ color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <Spacer h={spacing.sm} />
        <Button title="Not now" variant="ghost" fullWidth onPress={onClose} />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  cardWaiting: { borderWidth: 1, borderColor: '#F0C26A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F6FBF9',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: '#EEF4F2' },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F6F1' },
});
