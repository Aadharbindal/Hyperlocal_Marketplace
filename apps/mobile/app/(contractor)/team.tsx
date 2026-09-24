import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { TechnicianView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAddTechnician, useRemoveTechnician, useSubmitTechnicianKyc, useTeam } from '@/api/contractor';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

/**
 * The crew.
 *
 * Two things this screen is careful about, because they are the ones that reach a customer's
 * front door:
 *
 * - A technician is **added**, never created. They must already have signed in on that phone,
 *   which is what proves they hold the number a customer will be shown.
 * - Added is not verified. The badge says so plainly, and an unverified person cannot be put on
 *   a job at all - so the screen tells the contractor what is still missing rather than letting
 *   them find out when an assignment is refused.
 */

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  VERIFIED: { label: 'verified', tone: 'success' },
  SUBMITTED: { label: 'in review', tone: 'warning' },
  UNDER_REVIEW: { label: 'in review', tone: 'warning' },
  REJECTED: { label: 'rejected', tone: 'danger' },
  SUSPENDED: { label: 'suspended', tone: 'danger' },
  UNVERIFIED: { label: 'needs documents', tone: 'neutral' },
};

const ADD_ERROR: Record<string, string> = {
  TECHNICIAN_NOT_REGISTERED: 'Ask them to install the app and sign in with this number first.',
  CANNOT_ADD_YOURSELF: 'That is your own number.',
  ALREADY_ON_ANOTHER_TEAM: 'They are already on another contractor team.',
};

export default function TeamScreen() {
  const t = useStrings();
  const team = useTeam();
  const add = useAddTechnician();
  const remove = useRemoveTechnician();
  const [adding, setAdding] = useState(false);

  function confirmRemove(person: TechnicianView) {
    Alert.alert(`Remove ${person.fullName}?`, 'They will stop seeing your jobs. Their own history stays theirs.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(person.userId) },
    ]);
  }

  const unverified = team.data?.filter((p) => p.verificationStatus !== 'VERIFIED').length ?? 0;

  return (
    <Screen withTabBar refreshing={team.isRefetching} onRefresh={() => void team.refetch()}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title" weight="bold">
            {t('tabs.team')}
          </Text>
          <Text variant="caption" tone="secondary">
            {team.data?.length ? `${team.data.length} on your crew` : 'The people who do your work'}
          </Text>
        </View>
        <Button title="Add" size="sm" icon="person-add-outline" onPress={() => setAdding(true)} />
      </View>
      <Spacer h={spacing.lg} />

      {/* Said up front, because an unverified person simply cannot be put on a job. */}
      {unverified > 0 ? (
        <>
          <View style={styles.notice}>
            <Ionicons name="shield-outline" size={16} color="#B26A00" />
            <Text variant="caption" style={{ flex: 1, color: '#7A5200' }}>
              {unverified === 1 ? 'One person still needs' : `${unverified} people still need`} documents before they can be
              sent to a customer.
            </Text>
          </View>
          <Spacer h={spacing.md} />
        </>
      ) : null}

      {team.isPending ? (
        <View style={styles.list}>
          <Skeleton height={84} />
          <Skeleton height={84} />
        </View>
      ) : team.isError ? (
        <ErrorState title={t('common.loadFailed')} body={t('common.checkConnection')} onRetry={() => void team.refetch()} />
      ) : team.data.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No crew yet"
          body="Add the people who work for you by their phone number. They need to have signed in on the app first."
          actionLabel="Add someone"
          onAction={() => setAdding(true)}
        />
      ) : (
        <View style={styles.list}>
          {team.data.map((person, i) => (
            <Animated.View key={person.userId} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(320)}>
              <TeamCard person={person} onRemove={() => confirmRemove(person)} />
            </Animated.View>
          ))}
        </View>
      )}

      <AddTechnicianSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdd={async (body) => {
          try {
            await add.mutateAsync(body);
            setAdding(false);
            return null;
          } catch (e) {
            const which = e instanceof ApiError ? (e.details as { contractor?: string[] } | undefined)?.contractor?.[0] : undefined;
            return (which && ADD_ERROR[which]) ?? 'We could not add them. Check the number and try again.';
          }
        }}
        busy={add.isPending}
      />
    </Screen>
  );
}

function TeamCard({ person, onRemove }: { person: TechnicianView; onRemove: () => void }) {
  const kyc = useSubmitTechnicianKyc();
  const [showKyc, setShowKyc] = useState(false);
  const meta = STATUS[person.verificationStatus] ?? { label: person.verificationStatus.toLowerCase(), tone: 'neutral' as const };

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text weight="bold" style={{ color: palette.primary }}>
            {person.fullName.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold">
            {person.fullName}
          </Text>
          <Text variant="micro" tone="muted">
            {person.phone}
          </Text>
        </View>
        <Badge tone={meta.tone} label={meta.label} />
      </View>

      <View style={styles.actions}>
        {person.verificationStatus === 'UNVERIFIED' || person.verificationStatus === 'REJECTED' ? (
          <Button title="Submit documents" size="sm" variant="secondary" onPress={() => setShowKyc(true)} />
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${person.fullName}`}>
          <Ionicons name="person-remove-outline" size={20} color={palette.textMuted} />
        </Pressable>
      </View>

      <KycSheet
        visible={showKyc}
        name={person.fullName}
        busy={kyc.isPending}
        onClose={() => setShowKyc(false)}
        onSubmit={async (documentType, documentNumber) => {
          try {
            await kyc.mutateAsync({ userId: person.userId, documentType, documentNumber, mime: 'image/jpeg', sizeBytes: 400_000 });
            setShowKyc(false);
            return null;
          } catch {
            return 'We could not submit those documents. Try again.';
          }
        }}
      />
    </Card>
  );
}

function AddTechnicianSheet({
  visible,
  onClose,
  onAdd,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (body: { phone: string; fullName: string }) => Promise<string | null>;
  busy: boolean;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = phone.replace(/\D/g, '').length === 10 && name.trim().length >= 3;

  return (
    <Sheet visible={visible} onClose={onClose} title="Add someone to your crew">
      <Text variant="micro" tone="muted">
        They need to have installed the app and signed in with this number. We will let them know
        you added them.
      </Text>
      <Spacer h={spacing.md} />
      <TextField
        label="Their mobile number"
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
        placeholder="98765 43210"
        keyboardType="number-pad"
        prefix="+91"
        maxLength={10}
      />
      <TextField label="Their name" value={name} onChangeText={setName} placeholder="As the customer should see it" autoCapitalize="words" />
      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}
      <Spacer h={spacing.sm} />
      <Button
        title="Add to crew"
        fullWidth
        loading={busy}
        disabled={!ready}
        onPress={() => {
          setError(null);
          void onAdd({ phone: `+91${phone}`, fullName: name.trim() }).then((message) => {
            if (message) setError(message);
            else {
              setPhone('');
              setName('');
            }
          });
        }}
      />
    </Sheet>
  );
}

const DOC_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
  { value: 'VOTER_ID', label: 'Voter ID' },
];

function KycSheet({
  visible,
  name,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  name: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (documentType: string, documentNumber: string) => Promise<string | null>;
}) {
  const [type, setType] = useState('AADHAAR');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet visible={visible} onClose={onClose} title={`Documents for ${name}`}>
      <Text variant="micro" tone="muted">
        Our team reviews these, not you. Until they do, this person cannot be sent to a customer.
      </Text>
      <Spacer h={spacing.md} />
      <View style={styles.chips}>
        {DOC_TYPES.map((d) => (
          <Pressable
            key={d.value}
            onPress={() => setType(d.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: type === d.value }}
            style={[styles.chip, type === d.value && styles.chipOn]}
          >
            <Text variant="micro" weight="semibold" style={{ color: type === d.value ? palette.textOnPrimary : palette.primaryDeep }}>
              {d.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Spacer h={spacing.md} />
      <TextField
        label="Document number"
        value={number}
        onChangeText={setNumber}
        placeholder="We store only the last four digits"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}
      <Spacer h={spacing.sm} />
      <Button
        title="Send for review"
        fullWidth
        loading={busy}
        disabled={number.trim().length < 4}
        onPress={() => {
          setError(null);
          void onSubmit(type, number.trim()).then((m) => m && setError(m));
        }}
      />
    </Sheet>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text variant="label" weight="bold">
          {title}
        </Text>
        {children}
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FFF6E5', borderRadius: radius.md, padding: spacing.md },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F6F1' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: '#EEF4F2', paddingTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#E8F6F1' },
  chipOn: { backgroundColor: palette.primary },
});
