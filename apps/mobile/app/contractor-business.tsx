import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { checkBusinessName } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useContractorProfile, useSaveContractorProfile } from '@/api/contractor';
import { useAddresses } from '@/api/jobs';
import { palette, spacing } from '@/theme';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  Spacer,
  StatTile,
  Text,
  TextField,
} from '@/ui';

/** The same options the provider's own screen offers, and the same server ceiling of 25 km. */
const RADIUS_OPTIONS = [3, 5, 8, 12, 20] as const;

const VERIFICATION: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  VERIFIED: { label: 'Verified', tone: 'success' },
  PENDING: { label: 'Being checked', tone: 'warning' },
  REJECTED: { label: 'Needs attention', tone: 'danger' },
  UNVERIFIED: { label: 'Not verified yet', tone: 'neutral' },
};

/**
 * A contractor's own business details.
 *
 * `GET` and `PUT /contractor/profile` have existed with nothing calling them, and the contractor's
 * profile tab was the shared one - so a whole role could add technicians and send them to jobs
 * while having no way to set the business name customers see, the radius that decides which jobs
 * reach them, or to find out whether the account was verified at all.
 *
 * The radius matters most of the three and is the least obvious: a contractor whose profile
 * defaulted to a small number simply saw fewer jobs, with nothing on any screen explaining why.
 */
export default function ContractorBusinessScreen() {
  const router = useRouter();
  const profile = useContractorProfile();
  const save = useSaveContractorProfile();
  const addresses = useAddresses();
  const reduced = useReducedMotion();

  const [businessName, setBusinessName] = useState('');
  const [radiusKm, setRadiusKm] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seeded once, then the contractor edits freely - a later refetch must not overwrite typing.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!profile.data || seeded) return;
    setSeeded(true);
    setBusinessName(profile.data.businessName ?? '');
    setRadiusKm(profile.data.serviceRadiusKm || 8);
  }, [profile.data, seeded]);

  const nameProblem = checkBusinessName(businessName);
  const defaultAddress = addresses.data?.items.find((a) => a.isDefault) ?? addresses.data?.items[0];
  const status = VERIFICATION[profile.data?.verificationStatus ?? 'UNVERIFIED'] ?? VERIFICATION.UNVERIFIED!;

  async function onSave() {
    setError(null);
    setSaved(false);
    if (nameProblem || businessName.trim().length < 3) return;
    try {
      await save.mutateAsync({
        businessName: businessName.trim(),
        serviceRadiusKm: radiusKm,
        ...(defaultAddress ? { baseAddressId: defaultAddress.id } : {}),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not save. Please try again.');
    }
  }

  return (
    <Screen keyboard refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={styles.flex}>
          Your business
        </Text>
      </View>
      <Spacer h={spacing.xl} />

      {profile.isPending ? (
        <Card style={styles.card}>
          <Skeleton height={18} width="50%" />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </Card>
      ) : profile.isError ? (
        <ErrorState
          title="We could not load your business details"
          body="They are still saved. Check your connection and try again."
          onRetry={() => void profile.refetch()}
          retrying={profile.isRefetching}
        />
      ) : (
        <Animated.View entering={reduced ? undefined : FadeInDown.duration(320)}>
          <Card style={styles.card}>
            <View style={styles.statusRow}>
              <Text variant="label" weight="semibold" style={styles.flex}>
                Verification
              </Text>
              <Badge tone={status.tone} label={status.label} />
            </View>
            <View style={styles.tiles}>
              <StatTile label="In your team" value={String(profile.data.teamSize)} />
              <StatTile
                label="Verified"
                value={String(profile.data.verifiedTeamSize)}
                hint={profile.data.verifiedTeamSize < profile.data.teamSize ? 'The rest cannot be sent out' : undefined}
              />
            </View>
          </Card>

          <Spacer h={spacing.lg} />

          <Card style={styles.card}>
            <TextField
              label="Business name"
              helper="Customers see this on jobs your team is sent to"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Sharma Electricals"
              icon="storefront-outline"
              autoCapitalize="words"
              maxLength={80}
              required
              error={nameProblem?.message ?? null}
            />

            <Text variant="caption" tone="secondary">
              How far will your team travel?
            </Text>
            {/* Said out loud because it is invisible otherwise: this is the setting that decides
                which jobs appear at all, and a contractor seeing none had no way to connect the
                two. */}
            <SegmentedControl
              label="How far will your team travel"
              options={RADIUS_OPTIONS.map((r) => ({ value: String(r), label: `${r} km` }))}
              value={String(radiusKm)}
              onChange={(v) => setRadiusKm(Number(v))}
            />

            {!defaultAddress ? (
              <Text variant="caption" tone="danger">
                Add an address first - the radius is measured from it.
              </Text>
            ) : (
              <Text variant="micro" tone="muted">
                {`Measured from ${defaultAddress.label ?? defaultAddress.line1}.`}
              </Text>
            )}

            {error ? (
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            ) : null}

            <Button
              title={saved ? 'Saved' : 'Save changes'}
              icon={saved ? 'checkmark' : undefined}
              fullWidth
              loading={save.isPending}
              disabled={!!nameProblem || businessName.trim().length < 3}
              onPress={() => void onSave()}
            />
          </Card>
        </Animated.View>
      )}

      <Spacer h={spacing.xl} />
      <Text variant="micro" tone="muted">
        Technicians are added on the Team tab, and each one has to be verified before they can be
        sent to a job.
      </Text>
      <Spacer h={spacing.xxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  card: { gap: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm },
});
