import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { formatInr, type RedispatchInvitationsResponse } from '@hyperlocal/core';
import { ApiError, api } from '@/api/client';
import { useSession } from '@/store/session';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Text } from '@/ui';

/**
 * Bookings this professional is being asked to cover, because whoever had them pulled out.
 *
 * Kept out of the ordinary offers feed on purpose. These are not new work to quote on: the price
 * is already fixed at what this provider themselves asked for last time, the clock is twenty
 * minutes rather than a bidding window, and the only two answers are yes and no.
 *
 * It renders nothing when there is nothing to answer, so it never becomes a permanent empty box
 * at the top of the jobs screen.
 */
export function RedispatchInvites() {
  const token = useSession((s) => s.accessToken);
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const [error, setError] = useState<string | null>(null);

  const invites = useQuery({
    queryKey: ['redispatch-invitations'],
    enabled: !!token,
    queryFn: () => api<RedispatchInvitationsResponse>('/me/redispatch-invitations'),
    // Short, because the offer expires in twenty minutes and a stale card here means somebody
    // taps a job that is already gone.
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api<unknown>(`/redispatch-invitations/${id}/respond`, { method: 'POST', body: { accept } }),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['redispatch-invitations'] });
      await qc.invalidateQueries({ queryKey: ['provider'] });
    },
  });

  const items = invites.data?.items ?? [];
  if (items.length === 0) return null;

  const answer = async (id: string, accept: boolean) => {
    setError(null);
    try {
      await respond.mutateAsync({ id, accept });
    } catch (e) {
      // "Somebody else got there first" is the ordinary outcome of a race, not a fault, and it
      // reads very differently from "something went wrong".
      const reason = e instanceof ApiError ? (e.details as { reason?: string } | undefined)?.reason : undefined;
      setError(
        reason === 'taken_by_someone_else' || reason === 'no_longer_available'
          ? 'Another professional took it first.'
          : reason === 'invitation_expired'
            ? 'That one has expired.'
            : e instanceof ApiError
              ? e.message
              : 'Could not answer right now.',
      );
    }
  };

  return (
    <View style={styles.wrap}>
      {items.map((inv, i) => (
        <Animated.View key={inv.id} entering={reduced ? undefined : FadeInDown.delay(i * 60).duration(360)}>
          <Card style={styles.card}>
            <View style={styles.head}>
              <View style={styles.icon}>
                <Ionicons name="alert-circle" size={19} color={palette.warning} />
              </View>
              <View style={styles.headText}>
                <Text variant="label" weight="bold" numberOfLines={1}>
                  {inv.categoryName}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {inv.areaLabel}
                </Text>
              </View>
              <Badge tone="warning" label="Needs covering" />
            </View>

            {/* Why they are being asked, so this does not read as an ordinary new job. */}
            <Text variant="caption" tone="secondary">
              The professional booked for this pulled out. You offered on it earlier — it is yours
              at your own price if you can take it.
            </Text>

            <View style={styles.money}>
              <Text variant="subheading" weight="bold">
                {formatInr(inv.totalPaise)}
              </Text>
              <Countdown expiresAt={inv.expiresAt} />
            </View>

            {error ? (
              <Text variant="micro" tone="danger">
                {error}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Button
                title="No thanks"
                size="sm"
                variant="ghost"
                style={styles.action}
                disabled={respond.isPending}
                onPress={() => void answer(inv.id, false)}
              />
              <Button
                title="I'll take it"
                size="sm"
                style={styles.action}
                loading={respond.isPending}
                onPress={() => void answer(inv.id, true)}
              />
            </View>
          </Card>
        </Animated.View>
      ))}
    </View>
  );
}

/** Minutes left, recomputed on each render of the polling parent. Deliberately not a live timer. */
function Countdown({ expiresAt }: { expiresAt: string }) {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
  return (
    <Text variant="micro" tone="muted">
      {minutes <= 0 ? 'Expiring now' : `${minutes} min left`}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { gap: spacing.sm, borderWidth: 2, borderColor: palette.warningSoft },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.warningSoft, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 1 },
  money: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  spacer: { height: radius.sm },
});
