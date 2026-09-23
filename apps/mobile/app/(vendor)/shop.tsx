import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { usePayoutAccount } from '@/api/finance';
import { materialKeys } from '@/api/materials';
import { useLogout, useMe } from '@/api/hooks';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, Screen, Skeleton, Spacer, Text } from '@/ui';

interface VendorProfile {
  shopName: string | null;
  verified: boolean;
  verificationStatus: string;
  deliveryAvailable: boolean;
  deliveryRadiusKm: number;
  materialCategories: string[];
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
        <Card style={styles.card}>
          <Text weight="semibold">Shop not set up yet</Text>
          <Text variant="caption" tone="secondary">
            Support will add your shop details and verify you before requests start arriving.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight="semibold">
                  Accepting deliveries
                </Text>
                <Text variant="micro" tone="muted">
                  {profile.data.deliveryAvailable ? 'You are receiving material requests.' : 'Requests are paused. Nothing new will arrive.'}
                </Text>
              </View>
              <Switch
                value={profile.data.deliveryAvailable}
                disabled={!profile.data.verified || setAvailable.isPending}
                onValueChange={(v) => setAvailable.mutate(v)}
                trackColor={{ true: palette.primary, false: '#D7E3DE' }}
                thumbColor="#FFFFFF"
              />
            </View>
            {!profile.data.verified && (
              <View style={styles.note}>
                <Ionicons name="shield-outline" size={14} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  Verification is {profile.data.verificationStatus.toLowerCase()}. You can quote once it is approved.
                </Text>
              </View>
            )}
          </Card>

          <Spacer h={spacing.md} />
          <Card style={styles.card}>
            <View style={styles.row}>
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                Verification
              </Text>
              <Badge tone={profile.data.verified ? 'success' : 'warning'} label={profile.data.verificationStatus.toLowerCase()} />
            </View>
            <View style={styles.row}>
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                Delivery radius
              </Text>
              <Text variant="caption" weight="medium">
                {profile.data.deliveryRadiusKm} km
              </Text>
            </View>
            <View style={styles.row}>
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                Supplies
              </Text>
              <Text variant="caption" weight="medium">
                {profile.data.materialCategories.join(', ') || 'Not set'}
              </Text>
            </View>
          </Card>
        </>
      )}

      <Spacer h={spacing.lg} />
      {/* A vendor is paid the same way a provider is, so it is the same screen underneath. */}
      <Pressable onPress={() => router.push('/payout-account')} accessibilityRole="button">
        <Card style={styles.payout}>
          <Ionicons name="wallet-outline" size={20} color={payoutAccount.data ? palette.textMuted : palette.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="semibold">
              {payoutAccount.data ? 'Where you get paid' : 'Add your bank details'}
            </Text>
            <Text variant="micro" tone="muted">
              {payoutAccount.data ? payoutAccount.data.masked : 'Payments for your supplies wait until we know where to send them'}
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
  payout: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
