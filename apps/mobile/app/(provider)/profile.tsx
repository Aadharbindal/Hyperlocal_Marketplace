import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { KYC_DOCUMENT_TYPES, checkBusinessName, type KycDocumentType } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCategories, useLogout, useMe } from '@/api/hooks';
import { useAddresses } from '@/api/jobs';
import { useProviderProfile, useSubmitKyc, useUpdateProviderProfile } from '@/api/provider';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { KYC_DOCUMENT, VERIFICATION } from '@/i18n/status';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, ErrorState, Screen, Skeleton, ChipMultiSelect, SegmentedControl, Spacer, StatTile, Text, TextField } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const RADIUS_OPTIONS = [2, 3, 5, 8, 12];


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
  const nameProblem = checkBusinessName(businessName);
  const [radiusKm, setRadiusKm] = useState(3);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [docType, setDocType] = useState<KycDocumentType>('AADHAAR');
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
    // The field already shows what is wrong; this stops a save that the server would reject anyway.
    if (nameProblem) return;
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
            <StatTile label="Jobs done" value={String(p.completedJobs)} />
            <StatTile label="Rating" value={p.ratingAvg ? `${p.ratingAvg.toFixed(1)} ★` : '—'} />
            <StatTile label="Reliability" value={p.reliabilityScore.toFixed(1)} />
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
                    {KYC_DOCUMENT[k.documentType as KycDocumentType] ?? k.documentType}
                    {k.last4 ? ` ••${k.last4}` : ''}
                  </Text>
                  <Badge tone={VERIFICATION[k.status].tone} label={VERIFICATION[k.status].label} />
                </View>
              ))}
            </View>
          )}

          {canSubmitKyc && (
            <>
              {/* Built from the enum the server accepts, not from a list typed out beside it.
                  The hand-written one offered four of six - somebody holding a voter ID or a GST
                  certificate had nothing to pick, for documents that would have been taken. */}
              <SegmentedControl
                label="Which document"
                scroll
                options={KYC_DOCUMENT_TYPES.map((k) => ({ value: k, label: KYC_DOCUMENT[k] }))}
                value={docType}
                onChange={setDocType}
              />
              <TextField
                label="Document number"
                value={docNumber}
                onChangeText={setDocNumber}
                placeholder="As printed on the document"
                icon="card-outline"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={30}
                accessibilityLabel="Document number"
              />
              <View style={styles.privacyNote}>
                <Ionicons name="lock-closed" size={13} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  Only the last four characters are stored. Customers never see your documents.
                </Text>
              </View>
              <Button
                title="Submit for verification"
                size="md"
                fullWidth
                loading={kyc.isPending}
                // `submitDocument` already refused a short number and set an error; waiting for the
                // number is the same answer given before the press instead of after it.
                disabled={docNumber.trim().length < 4}
                onPress={submitDocument}
                style={styles.cardCta}
              />
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
          {/* This is the name customers see on an offer, so a held-down key here costs the provider
              the work rather than costing us a support ticket. */}
          <TextField
            label="Business name"
            helper="Customers see this on your offers"
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="A1 Electricals"
            icon="storefront-outline"
            autoCapitalize="words"
            maxLength={80}
            accessibilityLabel="Business name"
            error={nameProblem?.message ?? null}
          />

          <Text variant="caption" tone="secondary" style={styles.subLabel}>
            How far will you travel?
          </Text>
          <SegmentedControl
            label="How far will you travel"
            options={RADIUS_OPTIONS.map((r) => ({ value: String(r), label: `${r} km` }))}
            value={String(radiusKm)}
            onChange={(v) => setRadiusKm(Number(v))}
          />

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
              {/* Checkboxes, not buttons. A provider working down fourteen skill chips with a
                  screen reader had no way to hear which ones were already on. */}
              <ChipMultiSelect
                label={`Skills in ${c.name}`}
                options={c.skills.map((sk) => ({ value: sk.id, label: sk.name }))}
                value={skillIds}
                onToggle={(id) => setSkillIds((v2) => (v2.includes(id) ? v2.filter((x) => x !== id) : [...v2, id]))}
              />
            </View>
          ))}

          {!defaultAddress && (
            <Text variant="caption" tone="danger" style={styles.subLabel}>
              Add an address first so we can find jobs near you.
            </Text>
          )}

          <Button
            title={saved ? 'Saved' : 'Save changes'}
            size="md"
            fullWidth
            icon={saved ? 'checkmark' : undefined}
            loading={update.isPending}
            // `save` already returned silently on a bad business name, which is a press that looks
            // like a failure with no message. The field says what is wrong; this says it is not
            // ready.
            disabled={!!nameProblem}
            onPress={save}
            style={styles.cardCta}
          />
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

const styles = StyleSheet.create({
  identity: { gap: spacing.lg },
  identityHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md },


  card: { marginTop: spacing.lg, gap: spacing.md },
  cardTitle: { fontSize: 15 },
  cardCta: { marginTop: spacing.sm },
  subLabel: { marginTop: spacing.sm },



  catBlock: { gap: spacing.sm },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  docList: { gap: spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  footer: { marginTop: spacing.xxl, gap: spacing.md, alignItems: 'center' },
});
