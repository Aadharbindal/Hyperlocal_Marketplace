import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { checkReason, checkRupees, formatInr } from '@hyperlocal/core';
import { useAdminUser } from '@/api/admin';
import {
  useAuditLog,
  useOpsOverview,
  useReactivateUser,
  useRetrySettlement,
  useRunTask,
  useScheduler,
  useSettlements,
  useSuspendUser,
  useUserSearch,
  type AdminUser,
} from '@/api/admin-console';
import { ApiError } from '@/api/client';
import { useCreatePromo, useDeactivatePromo, usePromos, useGenerateRecoveryCodes, useRecoveryCodeCount } from '@/api/admin-trust';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, DataRow, ErrorState, Screen, SegmentedControl, Skeleton, Spacer, StatTile, Text, TextField } from '@/ui';

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

      <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Console sections">
        {SECTIONS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSection(s.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === s.id }}
            aria-selected={section === s.id}
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

/** What each payout state is called. Staff read these too. */
const SETTLEMENT_LABEL = { ON_HOLD: 'On hold', FAILED: 'Failed', PENDING: 'Waiting', PAID: 'Paid' } as const;

/** `PROVIDER` as `Provider`. These are read by staff, but they are still words. */
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** A heading on a card, so a group of numbers says what it is a group of. */
function GroupTitle({ children, icon }: { children: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.groupHead}>
      <Ionicons name={icon} size={14} color={palette.iconFaint} />
      <Text variant="micro" weight="bold" tone="muted" style={styles.groupTitle}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * The first thing somebody sees during an incident.
 *
 * It was eight identical rows in two unlabelled cards: "Live jobs 0" set exactly like "Payouts
 * sent ₹0", and no way to tell which card was work and which was money without reading five lines
 * of it. This is the screen the comment at the top of the file calls "a place people come to
 * answer a specific question during an incident", and an incident is precisely when a wall of
 * same-sized grey rows is useless.
 *
 * So the three numbers somebody is actually scanning for are tiles, the rest are headed groups,
 * and the two counts the report has always carried and this screen never showed - how many
 * professionals are verified, and how many are suspended - are on it.
 */
function Overview() {
  const overview = useOpsOverview();
  if (overview.isPending) return <Skeleton height={200} />;
  if (overview.isError) return <ErrorState title="Could not load" body="Try again." onRetry={() => void overview.refetch()} />;

  const d = overview.data;
  const needsSomebody = d.disputesBreachingSla > 0 || d.kycPending > 0;
  return (
    <>
      {/* Anything that needs somebody today comes first, and only when it is non-zero. A zero in
          red is a false alarm that teaches people to stop looking at the top of the screen. */}
      {needsSomebody ? (
        <>
          <Card style={styles.alert}>
            <GroupTitle icon="alert-circle-outline">Needs somebody today</GroupTitle>
            <View style={styles.tileRow}>
              {d.disputesBreachingSla > 0 ? (
                <StatTile
                  style={styles.tile}
                  label="Disputes past SLA"
                  value={String(d.disputesBreachingSla)}
                  tone="danger"
                  icon="alert-circle"
                />
              ) : null}
              {d.kycPending > 0 ? (
                <StatTile style={styles.tile} label="Verifications waiting" value={String(d.kycPending)} icon="shield-outline" />
              ) : null}
            </View>
          </Card>
          <Spacer h={spacing.md} />
        </>
      ) : null}

      {/* The live picture, as three numbers rather than three rows. These are what somebody scans
          for; a row puts the figure last and the same size as its own label. */}
      <View style={styles.tileRow}>
        <StatTile style={styles.tile} label="Live jobs" value={String(d.liveJobs)} icon="flash-outline" />
        <StatTile
          style={styles.tile}
          label="Open disputes"
          value={String(d.disputesOpen)}
          tone={d.disputesOpen > 0 ? 'danger' : 'default'}
          icon="alert-circle-outline"
        />
        <StatTile style={styles.tile} label="Completed" value={String(d.completedJobs)} icon="checkmark-done-outline" />
      </View>

      <Spacer h={spacing.md} />
      <Card style={styles.group}>
        <GroupTitle icon="cash-outline">Money</GroupTitle>
        <DataRow label="Captured" value={formatInr(d.capturedPaise)} />
        <DataRow label="Refunded" value={formatInr(d.refundedPaise)} />
        <DataRow label="Payouts sent" value={formatInr(d.payoutsPaidPaise)} />
        {/* The one number on this card somebody can act on, so it is the one that is emphasised -
            money waiting is a person waiting to be paid. */}
        <DataRow
          label="Payouts waiting"
          value={formatInr(d.payoutsPendingPaise)}
          tone={d.payoutsPendingPaise > 0 ? 'danger' : 'default'}
        />
        <DataRow label="Platform revenue" value={formatInr(d.platformRevenuePaise)} total />
      </Card>

      <Spacer h={spacing.md} />
      <Card style={styles.group}>
        <GroupTitle icon="people-outline">Professionals</GroupTitle>
        {/* Both of these have been in the report since it was written and on no screen until now.
            Suspensions in particular: the number going up is the thing somebody wants to notice
            without going looking for it. */}
        <DataRow label="Verified" value={String(d.providersVerified)} />
        <DataRow
          label="Suspended"
          value={String(d.providersSuspended)}
          tone={d.providersSuspended > 0 ? 'danger' : 'default'}
        />
      </Card>

      <Spacer h={spacing.sm} />
      {/* Attached to a control rather than floating: during an incident the question behind
          "as of" is always "is this stale", and the answer to that is a refresh. */}
      <Pressable
        onPress={() => void overview.refetch()}
        accessibilityRole="button"
        accessibilityLabel={`Updated at ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Refresh`}
        accessibilityState={{ busy: overview.isRefetching }}
        aria-busy={overview.isRefetching}
        style={styles.asOf}
      >
        <Ionicons name="refresh" size={13} color={palette.iconFaint} />
        <Text variant="micro" tone="muted">
          {overview.isRefetching
            ? 'Refreshing'
            : `As of ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`}
        </Text>
      </Pressable>
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
  const suspend = useSuspendUser();
  const reactivate = useReactivateUser();
  const [showHistory, setShowHistory] = useState(false);
  /**
   * The full record, fetched only when asked for.
   *
   * `GET /admin/users/:id` carries what the search row does not - verification status, reliability,
   * rating, completed jobs, **strikes** and what is owed - and had no caller at all. Strikes matter
   * most here: suspension thresholds are strike-based, so deciding to suspend somebody without them
   * on screen is deciding blind. It is behind a tap rather than eager, because a search of twelve
   * people should not fire twelve detail requests.
   */
  const [showRecord, setShowRecord] = useState(false);
  const record = useAdminUser(showRecord ? user.id : undefined);
  const [acting, setActing] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasonProblem = reason.trim() ? checkReason(reason) : null;
  // Twenty characters is the server's floor for a suspension; reactivating takes a reason too but
  // is not held to that length, so the same check runs with the looser bar it actually enforces.
  const canSuspend = reason.trim().length >= 20 && !reasonProblem && /^[0-9a-f-]{36}$/i.test(approver.trim());
  const canReactivate = !!reason.trim() && !reasonProblem;

  async function run() {
    setError(null);
    try {
      if (acting === 'suspend') {
        await suspend.mutateAsync({ userId: user.id, reason: reason.trim(), secondApproverId: approver.trim() });
      } else {
        await reactivate.mutateAsync({ userId: user.id, reason: reason.trim() });
      }
      setActing(null);
      setReason('');
      setApprover('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not go through.');
    }
  }

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="semibold">
            {user.displayName ?? 'No name'}
          </Text>
          <Text variant="micro" tone="muted">
            {user.phone} ·{' '}
            {user.roles.length
              ? user.roles.map((r) => (r.status === 'ACTIVE' ? titleCase(r.role) : `${titleCase(r.role)} (${r.status.toLowerCase()})`)).join(', ')
              : 'no roles'}
          </Text>
        </View>
        <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'} label={user.status.toLowerCase()} />
      </View>

      {user.suspendedReason ? (
        <Text variant="micro" tone="muted">
          Suspended: {user.suspendedReason}
        </Text>
      ) : null}

      {/*
        This used to say suspension was "not offered as a button here - doing it properly means the
        dispute or verification screen where the second person is already involved". That screen was
        never built, so in practice neither action was reachable from anywhere: an account could be
        suspended by nothing, and - the worse half - a suspended account could never be brought back.
        A one-way door that only exists in the database is not a safeguard.

        The two-person rule is kept and made visible rather than hidden. The approver's id is a field
        somebody has to go and get, which is the friction the rule is actually for; the server checks
        it regardless. Reactivating needs one person and a reason, which is what the endpoint has
        always required.
      */}
      {acting ? (
        <View style={styles.action}>
          <TextField
            label={acting === 'suspend' ? 'Why this account is being suspended' : 'Why it is being restored'}
            helper={acting === 'suspend' ? 'At least 20 characters, and it is kept on the record' : 'Kept on the record'}
            value={reason}
            onChangeText={setReason}
            placeholder={
              acting === 'suspend'
                ? 'Repeated no-shows after three warnings, confirmed in tickets 412 and 455'
                : 'Identity re-verified and the documents now match'
            }
            multiline
            minLines={2}
            maxLength={500}
            counter
            required
            error={reasonProblem?.message ?? null}
          />
          {acting === 'suspend' ? (
            <TextField
              label="Second approver"
              helper="Their user id. It cannot be you, and the server checks that."
              value={approver}
              onChangeText={setApprover}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoCapitalize="none"
              autoCorrect={false}
              required
            />
          ) : null}
          {error ? (
            <Text variant="micro" tone="danger">
              {error}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <Button title="Cancel" size="sm" variant="ghost" onPress={() => { setActing(null); setError(null); }} />
            <Button
              title={acting === 'suspend' ? 'Suspend' : 'Restore'}
              size="sm"
              variant={acting === 'suspend' ? 'danger' : 'primary'}
              loading={suspend.isPending || reactivate.isPending}
              disabled={acting === 'suspend' ? !canSuspend : !canReactivate}
              onPress={() => void run()}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actionRow}>
          {user.status === 'ACTIVE' ? (
            <Button title="Suspend" size="sm" variant="ghost" onPress={() => { setActing('suspend'); setReason(''); }} />
          ) : (
            <Button title="Restore access" size="sm" variant="secondary" onPress={() => { setActing('reactivate'); setReason(''); }} />
          )}
        </View>
      )}

      <Pressable onPress={() => setShowRecord((v) => !v)} accessibilityRole="button" style={styles.linkRow}>
        <Text variant="micro" style={{ color: palette.primary }}>
          {showRecord ? 'Hide the full record' : 'The full record'}
        </Text>
        <Ionicons name={showRecord ? 'chevron-up' : 'chevron-down'} size={14} color={palette.primary} />
      </Pressable>

      {showRecord ? (
        record.isPending ? (
          <Skeleton height={90} />
        ) : record.isError ? (
          <Text variant="micro" tone="danger">
            Could not load the record.
          </Text>
        ) : (
          <View style={styles.record}>
            <DataRow label="Verification" value={record.data.verification ?? 'none on file'} />
            <DataRow label="Jobs completed" value={String(record.data.completedJobs)} />
            {record.data.ratingAvg !== null ? (
              <DataRow label="Rating" value={record.data.ratingAvg.toFixed(1)} />
            ) : null}
            {record.data.reliabilityScore !== null ? (
              <DataRow label="Reliability" value={record.data.reliabilityScore.toFixed(1)} />
            ) : null}
            <DataRow
              label="Owed to them"
              value={formatInr(record.data.owedPaise)}
              tone={record.data.owedPaise > 0 ? 'primary' : 'muted'}
            />
            {/* Spelled out rather than counted: "three strikes" is a number, and what they were
                for is the thing a decision should rest on. */}
            <DataRow
              label="Strikes"
              value={record.data.strikes.length === 0 ? 'none' : String(record.data.strikes.length)}
              tone={record.data.strikes.length > 0 ? 'danger' : 'default'}
            />
            {record.data.strikes.map((st) => (
              <Text key={st.id} variant="micro" tone="muted">
                {`${new Date(st.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${st.severity.toLowerCase()} · ${st.reason}`}
              </Text>
            ))}
          </View>
        )
      ) : null}

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
      <SegmentedControl
        label="Settlement status"
        scroll
        options={(['ON_HOLD', 'FAILED', 'PENDING', 'PAID'] as const).map((s) => ({
          value: s,
          label: SETTLEMENT_LABEL[s],
        }))}
        value={status}
        onChange={setStatus}
      />
      <Spacer h={spacing.md} />

      {settlements.isPending ? (
        <Skeleton height={80} />
      ) : settlements.isError ? (
        /* "Nothing in that state" for a failed request tells somebody chasing a stuck payout that
           there is no stuck payout. The same false negative the vendor's shop card had. */
        <ErrorState
          title="Could not load payouts"
          body="Check the connection and try again."
          onRetry={() => void settlements.refetch()}
          retrying={settlements.isRefetching}
        />
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

  /**
   * A promo code is the platform's own money, so the ceiling here is the thing that matters.
   *
   * Five thousand rupees off is already far more than any job in the pilot costs; a code created with
   * an extra zero would be live and claimable before anybody noticed.
   */
  const amountProblem = checkRupees(amount, { max: 5_000, what: 'A discount' });
  const ready = code.trim().length >= 3 && Number(amount) > 0 && !amountProblem;

  return (
    <>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="label" weight="semibold">
          New flat-amount code
        </Text>
        <TextField value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="SAVE100" label="Code" autoCapitalize="characters" />
        <TextField
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
          placeholder="100"
          label="Rupees off"
          keyboardType="number-pad"
          error={amountProblem?.message}
        />
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
      <View style={styles.tileRow}>
        <StatTile
          style={styles.tile}
          label="Open streams"
          value={String(scheduler.data.streams.streams)}
          hint={`${scheduler.data.streams.users} ${scheduler.data.streams.users === 1 ? 'person' : 'people'}`}
          icon="pulse-outline"
        />
      </View>
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


const styles = StyleSheet.create({
  record: { gap: spacing.sm },
  action: { gap: spacing.md },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  tabOn: { backgroundColor: palette.primary },
  group: { gap: spacing.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  groupTitle: { letterSpacing: 0.6 },
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  // Equal shares, so three numbers of different widths do not make three different-sized tiles.
  tile: { flex: 1 },
  asOf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 32 },
  alert: { gap: spacing.sm, borderWidth: 1, borderColor: palette.danger },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codes: { gap: 2, borderWidth: 1, borderColor: palette.primary },
  codeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  code: { fontFamily: undefined, letterSpacing: 1, backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: spacing.md },
});
