import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { VerificationStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { api } from '@/api/client';
import { usePayoutAccount } from '@/api/finance';
import { materialKeys } from '@/api/materials';
import { useLogout, useMe } from '@/api/hooks';
import { VERIFICATION } from '@/i18n/status';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, DataRow, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

interface VendorProfile {
  shopName: string | null;
  verified: boolean;
  verificationStatus: VerificationStatus;
  deliveryAvailable: boolean;
  deliveryRadiusKm: number;
  materialCategories: string[];
}

/** `DataRow` takes a string; this is the same row when the value is a badge. */
function DataRowLike({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

export default function VendorShopScreen() {
  const me = useMe(true);
  const router = useRouter();
  const qc = useQueryClient();
  const payoutAccount = usePayoutAccount();
  const logout = useLogout();
  const profile = useQuery({ queryKey: ['vendor', 'profile'], queryFn: () => api<VendorProfile>('/vendor/profile') });
  const setAvailable = useMutation({
    mutationFn: (deliveryAvailable: boolean) => api<{ deliveryAvailable: boolean }>('/vendor/availability', { method: 'POST', body: { deliveryAvailable } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendor', 'profile'] });
      void qc.invalidateQueries({ queryKey: materialKeys.vendorFeed() });
    },
  });

  return (
    <Screen withTabBar refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <Text variant="title" weight="bold">
        {profile.data?.shopName ?? me.data?.user.displayName ?? 'Your shop'}
      </Text>
      <Spacer h={spacing.lg} />

      {profile.isPending ? (
        <Card style={styles.card}>
          <Skeleton height={16} width="40%" />
          <Skeleton height={40} />
        </Card>
      ) : profile.isError ? (
        /*
         * A 404 means there is genuinely no shop yet. Anything else - offline, a 500 - means we do
         * not know, and saying "Shop not set up yet" to somebody whose shop has been trading for a
         * month is both wrong and alarming. The payout card below already drew this distinction;
         * this card was making exactly the mistake its comment warns about.
         */
        profile.error instanceof ApiError && profile.error.status === 404 ? (
          <Card style={styles.card}>
            <Text weight="semibold">Shop not set up yet</Text>
            <Text variant="caption" tone="secondary">
              Support will add your shop details and verify you before requests start arriving.
            </Text>
          </Card>
        ) : (
          <ErrorState
            title="We could not load your shop"
            body="Check your connection and try again. Nothing has changed."
            onRetry={() => void profile.refetch()}
            retrying={profile.isRefetching}
          />
        )
      ) : (
        <>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight="semibold">
                  Accepting deliveries
                </Text>
                {/*
                  Verification is the other half of this sentence. `deliveryAvailable` can be true
                  while verification is pending - the switch is only refused on the way *on*, so a
                  shop verified once and later moved back to review keeps the stored `true` - and
                  the feed blocks an unverified vendor regardless. This card was saying "You are
                  receiving material requests" to somebody whose requests screen says the opposite.
                */}
                <Text variant="micro" tone="muted">
                  {!profile.data.verified
                    ? 'Nothing will arrive until your shop is verified.'
                    : profile.data.deliveryAvailable
                      ? 'You are receiving material requests.'
                      : 'Requests are paused. Nothing new will arrive.'}
                </Text>
              </View>
              <Switch
                value={profile.data.deliveryAvailable}
                disabled={!profile.data.verified || setAvailable.isPending}
                onValueChange={(v) => setAvailable.mutate(v)}
                trackColor={{ true: palette.primary, false: palette.borderStrong }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Accepting deliveries"
                /* The server refuses to turn this on before verification, so the control is
                   correctly disabled - but a disabled switch that says nothing is a dead end. The
                   note below says it on screen; this says it to a screen reader. */
                accessibilityHint={!profile.data.verified ? 'You can accept deliveries once your shop is verified.' : undefined}
              />
            </View>
            {!profile.data.verified && (
              <View style={styles.note}>
                <Ionicons name="shield-outline" size={14} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  {VERIFICATION[profile.data.verificationStatus].body}
                  {profile.data.verificationStatus === 'SUBMITTED' || profile.data.verificationStatus === 'UNDER_REVIEW'
                    ? ' You can quote once it is approved.'
                    : ''}
                </Text>
              </View>
            )}
          </Card>

          <Spacer h={spacing.md} />
          <Card style={styles.card}>
            <DataRowLike label="Verification">
              <Badge
                tone={VERIFICATION[profile.data.verificationStatus].tone}
                label={VERIFICATION[profile.data.verificationStatus].label}
              />
            </DataRowLike>
            <DataRow label="Delivery radius" value={`${profile.data.deliveryRadiusKm} km`} />
            <DataRow label="Supplies" value={profile.data.materialCategories.join(', ') || 'Not set'} />
          </Card>
        </>
      )}

      <Spacer h={spacing.lg} />
      {/* A vendor is paid the same way a provider is, so it is the same screen underneath.
          Three states deliberately: a failed read used to render as "Add your bank details", which
          tells somebody who already registered an account that they have not - and invites them to
          replace working details with a second copy. */}
      <Pressable onPress={() => router.push('/payout-account')} accessibilityRole="button">
        <Card style={styles.payout}>
          <Ionicons
            name={payoutAccount.isError ? 'alert-circle-outline' : 'wallet-outline'}
            size={20}
            color={payoutAccount.isError ? palette.warning : payoutAccount.data ? palette.textMuted : palette.primary}
          />
          <View style={styles.payoutText}>
            <Text variant="label" weight="semibold">
              {payoutAccount.isPending
                ? 'Checking your payout details'
                : payoutAccount.isError
                  ? 'We could not check your payout details'
                  : payoutAccount.data
                    ? 'Where you get paid'
                    : 'Add your bank details'}
            </Text>
            <Text variant="micro" tone="muted">
              {payoutAccount.isPending
                ? 'One moment'
                : payoutAccount.isError
                  ? 'Open this to try again - you may already have an account registered'
                  : payoutAccount.data
                    ? payoutAccount.data.masked
                    : 'Payments for your supplies wait until we know where to send them'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Card>
      </Pressable>

      <Spacer h={spacing.xl} />
      <Button title="Sign out" variant="ghost" fullWidth onPress={() => void logout.mutateAsync()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  payoutText: { flex: 1, gap: 1 },
  payout: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
