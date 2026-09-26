import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { formatInr } from '@hyperlocal/core';
import {
  useAuditLog,
  useOpsOverview,
  useRetrySettlement,
  useRunTask,
  useScheduler,
  useSettlements,
  useUserSearch,
  type AdminUser,
} from '@/api/admin-console';
import { useCreatePromo, useDeactivatePromo, usePromos, useGenerateRecoveryCodes, useRecoveryCodeCount } from '@/api/admin-trust';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, ErrorState, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

/**
 * The parts of the console that had an API and no screen.
 *
 * Eleven admin route groups existed and three of them were reachable. Everything else meant
 * somebody in support running curl against production, which is both slow and exactly how a
 * wrong id ends up in a destructive call.
 *
 * It is one screen with sections rather than six tabs: this is a place people come to answer a
 * specific question during an incident, and a tab bar of six things is six guesses about where
 * the answer lives.
 */

type Section = 'overview' | 'people' | 'money' | 'promos' | 'jobs' | 'security';

const SECTIONS: Array<{ id: Section; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'overview', label: 'Overview', icon: 'speedometer-outline' },
  { id: 'people', label: 'People', icon: 'people-outline' },
  { id: 'money', label: 'Payouts', icon: 'cash-outline' },
  { id: 'promos', label: 'Promos', icon: 'pricetag-outline' },
  { id: 'jobs', label: 'Background', icon: 'time-outline' },
  { id: 'security', label: 'Security', icon: 'lock-closed-outline' },
];

export default function ConsoleScreen() {
  const [section, setSection] = useState<Section>('overview');

  return (
    <Screen withTabBar>
      <Text variant="title" weight="bold">
        Console
      </Text>
      <Spacer h={spacing.md} />

      <View style={styles.tabs}>
        {SECTIONS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSection(s.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === s.id }}
            style={[styles.tab, section === s.id && styles.tabOn]}
          >
            <Ionicons name={s.icon} size={14} color={section === s.id ? palette.textOnPrimary : palette.primaryDeep} />
            <Text variant="micro" weight="semibold" style={{ color: section === s.id ? palette.textOnPrimary : palette.primaryDeep }}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Spacer h={spacing.lg} />

      {section === 'overview' && <Overview />}
      {section === 'people' && <People />}
      {section === 'money' && <Payouts />}
      {section === 'promos' && <Promos />}
      {section === 'jobs' && <Background />}
      {section === 'security' && <Security />}
    </Screen>
  );
}

function Overview() {
  const overview = useOpsOverview();
  if (overview.isPending) return <Skeleton height={200} />;
  if (overview.isError) return <ErrorState title="Could not load" body="Try again." onRetry={() => void overview.refetch()} />;

  const d = overview.data;
  return (
    <>
      {/* Anything that needs somebody today comes first, and only when it is non-zero. */}
      {d.disputesBreachingSla > 0 || d.kycPending > 0 ? (
        <>
          <Card style={styles.alert}>
            {d.disputesBreachingSla > 0 ? (
              <Row label="Disputes past their SLA" value={String(d.disputesBreachingSla)} urgent />
            ) : null}
            {d.kycPending > 0 ? <Row label="Verifications waiting" value={String(d.kycPending)} /> : null}
          </Card>
          <Spacer h={spacing.md} />
        </>
      ) : null}

      <Card style={styles.group}>
        <Row label="Live jobs" value={String(d.liveJobs)} />
        <Row label="Completed" value={String(d.completedJobs)} />
        <Row label="Open disputes" value={String(d.disputesOpen)} />
      </Card>

      <Spacer h={spacing.md} />
      <Card style={styles.group}>
        <Row label="Captured" value={formatInr(d.capturedPaise)} />
        <Row label="Refunded" value={formatInr(d.refundedPaise)} />
        <Row label="Platform revenue" value={formatInr(d.platformRevenuePaise)} />
        <Row label="Payouts waiting" value={formatInr(d.payoutsPendingPaise)} />
        <Row label="Payouts sent" value={formatInr(d.payoutsPaidPaise)} />
      </Card>

      <Spacer h={spacing.sm} />
      <Text variant="micro" tone="muted" center>
        As of {new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
      </Text>
    </>
  );
}

function People() {
  const [q, setQ] = useState('');
  const results = useUserSearch(q);

  return (
    <>
      <TextField
        value={q}
        onChangeText={setQ}
        placeholder="Phone, name or user id"
        icon="search-outline"
        autoCapitalize="none"
        autoCorrect={false}
        helper="Support sees masked numbers; an admin sees them in full."
      />
      <Spacer h={spacing.md} />

      {q.trim().length < 2 ? (
        <Text variant="caption" tone="muted">
          Type at least two characters.
        </Text>
      ) : results.isPending ? (
        <Skeleton height={80} />
      ) : (results.data ?? []).length === 0 ? (
        <Text variant="caption" tone="muted">
          Nobody matches that.
        </Text>
      ) : (
        <View style={styles.list}>
          {results.data!.map((u) => (
            <PersonCard key={u.id} user={u} />
          ))}
        </View>
      )}
    </>
  );
}

function PersonCard({ user }: { user: AdminUser }) {
  const audit = useAuditLog('user', user.id);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="semibold">
            {user.displayName ?? 'No name'}
          </Text>
          <Text variant="micro" tone="muted">
            {user.phone} · {user.roles.join(', ').toLowerCase() || 'no roles'}
          </Text>
        </View>
        <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'} label={user.status.toLowerCase()} />
      </View>

      {user.suspendedReason ? (
        <Text variant="micro" tone="muted">
          Suspended: {user.suspendedReason}
        </Text>
      ) : null}

      {/* Suspension is a two-person action and needs a second approver's id, so it is not
          offered as a button here - doing it properly means the dispute or verification screen
          where the second person is already involved. */}
      <Pressable onPress={() => setShowHistory((v) => !v)} accessibilityRole="button" style={styles.linkRow}>
        <Text variant="micro" style={{ color: palette.primary }}>
          {showHistory ? 'Hide history' : 'What has happened to this account'}
        </Text>
        <Ionicons name={showHistory ? 'chevron-up' : 'chevron-down'} size={14} color={palette.primary} />
      </Pressable>

      {showHistory ? (
        audit.isPending ? (
          <Skeleton height={60} />
        ) : (audit.data ?? []).length === 0 ? (
          <Text variant="micro" tone="muted">
            Nothing recorded.
          </Text>
        ) : (
          <View style={{ gap: 4 }}>
            {audit.data!.slice(0, 8).map((e) => (
              <View key={e.id} style={styles.auditRow}>
                <Text variant="micro" weight="semibold">
                  {e.action}
                </Text>
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  {e.reason ?? ''}
                </Text>
                <Text variant="micro" tone="muted">
                  {new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
            ))}
          </View>
        )
      ) : null}
    </Card>
  );
}

function Payouts() {
  const [status, setStatus] = useState('ON_HOLD');
  const settlements = useSettlements(status);
  const retry = useRetrySettlement();

  return (
    <>
      <View style={styles.chips}>
        {['ON_HOLD', 'FAILED', 'PENDING', 'PAID'].map((s) => (
          <Pressable key={s} onPress={() => setStatus(s)} accessibilityRole="button" style={[styles.chip, status === s && styles.chipOn]}>
            <Text variant="micro" weight="semibold" style={{ color: status === s ? palette.textOnPrimary : palette.primaryDeep }}>
              {s.toLowerCase().replace('_', ' ')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Spacer h={spacing.md} />

      {settlements.isPending ? (
        <Skeleton height={80} />
      ) : (settlements.data ?? []).length === 0 ? (
        <Text variant="caption" tone="muted">
          Nothing in that state.
        </Text>
      ) : (
        <View style={styles.list}>
          {settlements.data!.map((s) => (
            <Card key={s.id} style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="bold">
                    {formatInr(s.amountPaise)}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {s.payeeRole.toLowerCase()} · {s.attempts} {s.attempts === 1 ? 'attempt' : 'attempts'}
                  </Text>
                  {s.failureReason ? (
                    <Text variant="micro" tone="muted">
                      {s.failureReason}
                    </Text>
                  ) : null}
                </View>
                {s.status === 'ON_HOLD' || s.status === 'FAILED' ? (
                  <Button title="Retry" size="sm" variant="secondary" loading={retry.isPending} onPress={() => retry.mutate(s.id)} />
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

function Promos() {
  const promos = usePromos();
  const create = useCreatePromo();
  const deactivate = useDeactivatePromo();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setError(null);
    try {
      await create.mutateAsync({
        code: code.trim().toUpperCase(),
        kind: 'FLAT',
        // Entered in rupees, stored in paise - the unit the whole ledger uses.
        value: Math.round(Number(amount) * 100),
        minOrderPaise: 0,
        maxPerCustomer: 1,
        firstJobOnly: false,
      });
      setCode('');
      setAmount('');
    } catch {
      setError('Could not create that code. It may already exist.');
    }
  }

  const ready = code.trim().length >= 3 && Number(amount) > 0;

  return (
    <>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="label" weight="semibold">
          New flat-amount code
        </Text>
        <TextField value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="SAVE100" label="Code" autoCapitalize="characters" />
        <TextField value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} placeholder="100" label="Rupees off" keyboardType="number-pad" />
        {error ? (
          <Text variant="micro" style={{ color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <Button title="Create" size="sm" loading={create.isPending} disabled={!ready} onPress={() => void make()} />
        <Text variant="micro" tone="muted">
          A discount is the platform&apos;s cost - the professional is paid what the quote said.
          Percentage codes need a ceiling and are created through the API for now.
        </Text>
      </Card>

      <Spacer h={spacing.md} />
      {promos.isPending ? (
        <Skeleton height={80} />
      ) : (
        <View style={styles.list}>
          {(promos.data ?? []).map((p) => (
            <Card key={p.id} style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight="semibold">
                  {p.code}
                </Text>
                <Text variant="micro" tone="muted">
                  {p.kind === 'FLAT' ? `${formatInr(p.value)} off` : `${p.value / 100}% off`} · used {p.redemptionCount}
                  {p.maxRedemptions ? ` of ${p.maxRedemptions}` : ''}
                </Text>
              </View>
              {p.active ? (
                <Button title="Stop" size="sm" variant="secondary" loading={deactivate.isPending} onPress={() => deactivate.mutate(p.id)} />
              ) : (
                <Badge tone="neutral" label="stopped" />
              )}
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

function Background() {
  const scheduler = useScheduler();
  const run = useRunTask();

  if (scheduler.isPending) return <Skeleton height={200} />;
  if (scheduler.isError) return <ErrorState title="Could not load" body="Try again." onRetry={() => void scheduler.refetch()} />;

  return (
    <>
      <Text variant="micro" tone="muted">
        {scheduler.data.streams.connections} live connections
      </Text>
      <Spacer h={spacing.md} />
      <View style={styles.list}>
        {scheduler.data.tasks.map((task) => (
          <Card key={task.task} style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight="semibold">
                  {task.task}
                </Text>
                <Text variant="micro" tone="muted">
                  {task.description}
                </Text>
              </View>
              <Button title="Run" size="sm" variant="secondary" loading={run.isPending} onPress={() => run.mutate(task.task)} />
            </View>
            <Text variant="micro" tone="muted">
              {task.lastRunAt
                ? `Last run ${new Date(task.lastRunAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · ${task.runs} runs`
                : 'Never run'}
            </Text>
            {/* An error that only lives in the logs is an error nobody sees. */}
            {task.lastError ? (
              <Text variant="micro" style={{ color: palette.danger }}>
                {task.lastError}
              </Text>
            ) : null}
          </Card>
        ))}
      </View>
    </>
  );
}

function Security() {
  const count = useRecoveryCodeCount();
  const generate = useGenerateRecoveryCodes();
  const [codes, setCodes] = useState<string[] | null>(null);

  function make() {
    Alert.alert(
      'Generate new codes?',
      'Any codes you already have stop working immediately. Make sure you can write these down now.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          style: 'destructive',
          onPress: () => generate.mutate(undefined, { onSuccess: (r) => setCodes(r.codes) }),
        },
      ],
    );
  }

  return (
    <>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="label" weight="semibold">
          Recovery codes
        </Text>
        <Text variant="micro" tone="muted">
          For getting back in if you lose the phone with your authenticator on it. Each works once.
        </Text>
        <Text variant="caption" tone="secondary">
          {count.data ? `${count.data.remaining} unused` : 'Loading…'}
        </Text>
        <Button title="Generate new codes" size="sm" variant="secondary" loading={generate.isPending} onPress={make} />
      </Card>

      {/* Shown exactly once. After this we hold only their fingerprints. */}
      {codes ? (
        <>
          <Spacer h={spacing.md} />
          <Card style={styles.codes}>
            <Text variant="label" weight="bold">
              Write these down now
            </Text>
            <Text variant="micro" tone="muted">
              This is the only time they are shown. We keep only their fingerprints.
            </Text>
            <Spacer h={spacing.sm} />
            <View style={styles.codeGrid}>
              {codes.map((c) => (
                <Text key={c} variant="label" weight="bold" style={styles.code}>
                  {c}
                </Text>
              ))}
            </View>
            <Spacer h={spacing.sm} />
            <Button title="I have written them down" size="sm" onPress={() => setCodes(null)} />
          </Card>
        </>
      ) : null}
    </>
  );
}

function Row({ label, value, urgent }: { label: string; value: string; urgent?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="label" weight="bold" style={urgent ? { color: palette.danger } : undefined}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#E8F6F1' },
  tabOn: { backgroundColor: palette.primary },
  group: { gap: spacing.sm },
  alert: { gap: spacing.sm, borderWidth: 1, borderColor: palette.danger },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#E8F6F1' },
  chipOn: { backgroundColor: palette.primary },
  codes: { gap: 2, borderWidth: 1, borderColor: palette.primary },
  codeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  code: { fontFamily: undefined, letterSpacing: 1, backgroundColor: '#F6FBF9', borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: spacing.md },
});
