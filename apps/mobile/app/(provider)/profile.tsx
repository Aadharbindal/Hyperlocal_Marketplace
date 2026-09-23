import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { VerificationStatus } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCategories, useLogout, useMe } from '@/api/hooks';
import { useAddresses } from '@/api/jobs';
import { useProviderProfile, useSubmitKyc, useUpdateProviderProfile } from '@/api/provider';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const RADIUS_OPTIONS = [2, 3, 5, 8, 12];

const DOCS = [
  { key: 'AADHAAR', label: 'Aadhaar' },
  { key: 'PAN', label: 'PAN' },
  { key: 'DRIVING_LICENCE', label: 'Driving licence' },
  { key: 'SHOP_LICENCE', label: 'Shop licence' },
];

const VERIFICATION: Record<VerificationStatus, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string; body: string }> = {
  VERIFIED: { tone: 'success', label: 'Verified', body: 'Customers can see your verified badge.' },
  SUBMITTED: { tone: 'warning', label: 'In review', body: 'We are checking your documents. This usually takes a day.' },
  UNDER_REVIEW: { tone: 'warning', label: 'In review', body: 'We are checking your documents. This usually takes a day.' },
  REJECTED: { tone: 'danger', label: 'Not accepted', body: 'Your documents were not accepted. Please submit again.' },
  SUSPENDED: { tone: 'danger', label: 'Suspended', body: 'Contact support to restore your account.' },
  UNVERIFIED: { tone: 'neutral', label: 'Not started', body: 'Submit one ID document to start receiving jobs.' },
};

export default function ProviderProfileScreen() {
  const t = useStrings();
  const me = useMe();
  const profile = useProviderProfile();
  const categories = useCategories();
  const addresses = useAddresses();
  const update = useUpdateProviderProfile();
  const kyc = useSubmitKyc();
  const logout = useLogout();
  const user = useSession((s) => s.user);
  const activeRole = useSession((s) => s.activeRole);
  const setActiveRole = useSession((s) => s.setActiveRole);

  const [businessName, setBusinessName] = useState('');
  const [radiusKm, setRadiusKm] = useState(3);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [docType, setDocType] = useState('AADHAAR');
  const [docNumber, setDocNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the form from the server once, then let the provider edit freely.
  useEffect(() => {
    if (!profile.data) return;
    setBusinessName((v) => v || profile.data.businessName || '');
    setRadiusKm(profile.data.serviceRadiusKm);
    setSkillIds((v) => (v.length ? v : profile.data.skills.map((s) => s.id)));
  }, [profile.data]);

  const v = profile.data?.verificationStatus ?? 'UNVERIFIED';
  const status = VERIFICATION[v];
  const canSubmitKyc = v === 'UNVERIFIED' || v === 'REJECTED';
  const defaultAddress = addresses.data?.items.find((a) => a.isDefault) ?? addresses.data?.items[0];

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        businessName: businessName.trim() || undefined,
        serviceRadiusKm: radiusKm,
        skillIds,
        ...(defaultAddress ? { baseAddressId: defaultAddress.id } : {}),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  async function submitDocument() {
    setError(null);
    if (docNumber.trim().length < 4) {
      setError('Enter the number printed on the document.');
      return;
    }
    try {
      await kyc.mutateAsync({ documentType: docType, documentNumber: docNumber.trim(), mime: 'image/jpeg', sizeBytes: 900_000 });
      setDocNumber('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  if (profile.isPending) {
    return (
      <Screen withTabBar>
        <Skeleton height={26} width="50%" />
        <Spacer h={spacing.lg} />
        <Skeleton height={120} />
        <Spacer h={spacing.lg} />
        <Skeleton height={200} />
      </Screen>
    );
  }
  if (profile.isError) {
    return (
      <Screen withTabBar>
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void profile.refetch()} retrying={profile.isRefetching} />
      </Screen>
    );
  }

  const p = profile.data;

  return (
    <Screen withTabBar refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <Text variant="title" weight="bold">
        {t('tabs.profile')}
      </Text>
      <Spacer h={spacing.lg} />

      {/* identity + score */}
      <Animated.View entering={FadeInDown.duration(360)}>
        <Card style={styles.identity}>
          <View style={styles.identityHead}>
            <View style={styles.identityText}>
              <Text variant="heading" weight="bold">
                {p.businessName ?? user?.displayName ?? 'Your business'}
              </Text>
              <Text variant="caption" tone="secondary">
                {user?.phoneMasked}
              </Text>
            </View>
            <Badge tone={status.tone} icon="shield-checkmark" label={status.label} />
          </View>
          <View style={styles.stats}>
            <Stat label="Jobs done" value={String(p.completedJobs)} />
            <Stat label="Rating" value={p.ratingAvg ? `${p.ratingAvg.toFixed(1)} ★` : '—'} />
            <Stat label="Reliability" value={p.reliabilityScore.toFixed(1)} />
          </View>
        </Card>
      </Animated.View>

      {/* verification */}
      <Animated.View entering={FadeInDown.delay(70).duration(360)}>
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.cardTitle}>
            {t('profile.verification')}
          </Text>
          <Text variant="caption" tone="secondary">
            {v === 'REJECTED' ? (p.kyc[0]?.rejectionReason ?? status.body) : status.body}
          </Text>

          {p.kyc.length > 0 && (
            <View style={styles.docList}>
              {p.kyc.map((k) => (
                <View key={k.id} style={styles.docRow}>
                  <Ionicons name="document-text-outline" size={16} color={palette.textSecondary} />
                  <Text variant="caption" style={{ flex: 1 }}>
                    {DOCS.find((d) => d.key === k.documentType)?.label ?? k.documentType}
                    {k.last4 ? ` ••${k.last4}` : ''}
                  </Text>
                  <Badge tone={VERIFICATION[k.status].tone} label={VERIFICATION[k.status].label} />
                </View>
              ))}
            </View>
          )}

          {canSubmitKyc && (
            <>
              <View style={styles.chips}>
                {DOCS.map((d) => {
                  const active = d.key === docType;
                  return (
                    <Pressable key={d.key} onPress={() => setDocType(d.key)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
                      <Text variant="caption" weight="semibold" style={active ? styles.chipTextActive : undefined}>
                        {d.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={docNumber}
                onChangeText={setDocNumber}
                placeholder="Document number"
                placeholderTextColor="#A9B8B1"
                autoCapitalize="characters"
                accessibilityLabel="Document number"
                style={styles.input}
              />
              <View style={styles.privacyNote}>
                <Ionicons name="lock-closed" size={13} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  Only the last four characters are stored. Customers never see your documents.
                </Text>
              </View>
              <Button title="Submit for verification" size="md" fullWidth loading={kyc.isPending} onPress={submitDocument} style={styles.cardCta} />
            </>
          )}
        </Card>
      </Animated.View>

      {/* business details */}
      <Animated.View entering={FadeInDown.delay(140).duration(360)}>
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.cardTitle}>
            Business details
          </Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="Business name"
            placeholderTextColor="#A9B8B1"
            accessibilityLabel="Business name"
            style={styles.input}
          />

          <Text variant="caption" tone="secondary" style={styles.subLabel}>
            How far will you travel?
          </Text>
          <View style={styles.chips}>
            {RADIUS_OPTIONS.map((r) => {
              const active = r === radiusKm;
              return (
                <Pressable key={r} onPress={() => setRadiusKm(r)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
                  <Text variant="caption" weight="semibold" style={active ? styles.chipTextActive : undefined}>
                    {r} km
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="caption" tone="secondary" style={styles.subLabel}>
            What do you work on?
          </Text>
          {categories.data?.items.map((c) => (
            <View key={c.id} style={styles.catBlock}>
              <View style={styles.catHead}>
                <RealisticIcon iconKey={c.iconKey} size={26} />
                <Text variant="label" weight="semibold">
                  {c.name}
                </Text>
              </View>
              <View style={styles.chips}>
                {c.skills.map((s) => {
                  const active = skillIds.includes(s.id);
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setSkillIds((v2) => (active ? v2.filter((x) => x !== s.id) : [...v2, s.id]))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      {active && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                      <Text variant="caption" weight="semibold" style={active ? styles.chipTextActive : undefined}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {!defaultAddress && (
            <Text variant="caption" tone="danger" style={styles.subLabel}>
              Add an address first so we can find jobs near you.
            </Text>
          )}

          <Button title={saved ? 'Saved' : 'Save changes'} size="md" fullWidth icon={saved ? 'checkmark' : undefined} loading={update.isPending} onPress={save} style={styles.cardCta} />
        </Card>
      </Animated.View>

      {error && (
        <Animated.View entering={FadeIn.duration(220)} style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color={palette.danger} />
          <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
            {error}
          </Text>
        </Animated.View>
      )}

      {/* role switch + sign out */}
      <View style={styles.footer}>
        {me.data?.user.roles.some((r) => r.role === 'CUSTOMER' && r.status === 'ACTIVE') && activeRole !== 'CUSTOMER' && (
          <Button title="Switch to customer" variant="secondary" size="md" icon="repeat" onPress={() => void setActiveRole('CUSTOMER')} />
        )}
        <Button title={t('profile.signOut')} variant="danger" size="md" icon="log-out-outline" loading={logout.isPending} onPress={() => logout.mutate()} />
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="label" weight="bold">
        {value}
      </Text>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { gap: spacing.lg },
  identityHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  stat: { alignItems: 'center', gap: 2 },

  card: { marginTop: spacing.lg, gap: spacing.md },
  cardTitle: { fontSize: 15 },
  cardCta: { marginTop: spacing.sm },
  subLabel: { marginTop: spacing.sm },

  input: { height: 52, borderRadius: radius.md, backgroundColor: palette.surfaceMuted, paddingHorizontal: spacing.lg, fontSize: 15, color: palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, minHeight: 38, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: palette.surfaceMuted },
  chipActive: { backgroundColor: palette.primary },
  chipTextActive: { color: '#FFFFFF' },

  catBlock: { gap: spacing.sm },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  docList: { gap: spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  footer: { marginTop: spacing.xxl, gap: spacing.md, alignItems: 'center' },
});
