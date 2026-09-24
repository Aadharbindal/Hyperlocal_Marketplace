import { Ionicons } from '@expo/vector-icons';

import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { JobView } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCategories } from '@/api/hooks';
import { useAddresses, useAttachMedia, useCreateDraft, useRemoveMedia, useSubmitJob, useUpdateDraft, type LocalMedia } from '@/api/jobs';
import { askForPhoto } from '@/features/capture/media';
import { VoiceNoteRecorder } from '@/features/capture/VoiceNoteRecorder';
import { useStrings } from '@/i18n';
import { layout, palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, IconButton, Screen, Text } from '@/ui';
import { RealisticIcon } from '@/ui/RealisticIcon';

const SLOTS = [
  { key: 'asap', label: 'As soon as possible', hours: 0 },
  { key: 'today', label: 'Later today', hours: 4 },
  { key: 'tomorrow', label: 'Tomorrow morning', hours: 18 },
];

const HAZARD_COPY: Record<string, string> = {
  GAS_LEAK: 'If you can smell gas, leave the area and call your gas emergency helpline before booking.',
  FIRE: 'If there is a fire, call 112 immediately. Do not wait for a provider.',
  ELECTRICAL: 'Switch off the mains and keep everyone away from exposed wiring.',
  FLOOD: 'Shut the main water valve if you can reach it safely.',
  STRUCTURAL: 'Keep away from the affected area until it has been inspected.',
};

export default function BookScreen() {
  const t = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string }>();
  const categories = useCategories();
  const addresses = useAddresses();

  const [job, setJob] = useState<JobView | null>(null);
  const [categoryId, setCategoryId] = useState(params.categoryId ?? '');
  const [description, setDescription] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [withMaterial, setWithMaterial] = useState(false);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [slot, setSlot] = useState('asap');
  const [error, setError] = useState<string | null>(null);

  const createDraft = useCreateDraft();
  const updateDraft = useUpdateDraft();
  const attach = useAttachMedia();
  const removeMedia = useRemoveMedia();
  const submit = useSubmitJob();

  // Default to the customer's default address as soon as the list arrives.
  useEffect(() => {
    if (!addressId && addresses.data?.items.length) {
      setAddressId((addresses.data.items.find((a) => a.isDefault) ?? addresses.data.items[0])!.id);
    }
  }, [addresses.data, addressId]);

  useEffect(() => {
    if (!categoryId && categories.data?.items.length) setCategoryId(categories.data.items[0]!.id);
  }, [categories.data, categoryId]);

  const selectedAddress = addresses.data?.items.find((a) => a.id === addressId) ?? null;
  const outOfZone = selectedAddress ? !selectedAddress.inPilotZone : false;
  const canContinue = !!categoryId && !!addressId && !outOfZone && (description.trim().length >= 12 || (job?.media.length ?? 0) > 0);

  /** The draft is created lazily: the first photo or the submit tap, whichever comes first. */
  async function ensureDraft(): Promise<JobView> {
    if (job) {
      const updated = await updateDraft.mutateAsync({
        id: job.id,
        categoryId,
        description: description.trim() || undefined,
        priority: urgent ? 'URGENT' : 'NORMAL',
        requestType: withMaterial ? 'LABOUR_AND_MATERIAL' : 'LABOUR_ONLY',
        addressId: addressId ?? undefined,
        preferredStart: preferredStart(),
      });
      setJob(updated);
      return updated;
    }
    const created = await createDraft.mutateAsync({
      categoryId,
      description: description.trim() || undefined,
      priority: urgent ? 'URGENT' : 'NORMAL',
      requestType: withMaterial ? 'LABOUR_AND_MATERIAL' : 'LABOUR_ONLY',
      addressId: addressId ?? undefined,
      preferredStart: preferredStart(),
    });
    setJob(created);
    return created;
  }

  function preferredStart(): string | undefined {
    const hours = SLOTS.find((s) => s.key === slot)?.hours ?? 0;
    if (!hours) return undefined;
    return new Date(Date.now() + hours * 3600_000).toISOString();
  }

  /** Camera or gallery - somebody in front of the leak wants one, somebody who photographed it
   *  this morning wants the other. */
  function addPhoto() {
    setError(null);
    askForPhoto((file) => void attachFile(file), setError);
  }

  async function attachFile(file: LocalMedia) {
    setError(null);
    try {
      const draft = await ensureDraft();
      await attach.mutateAsync({ jobId: draft.id, file });
      const refreshed = await updateDraft.mutateAsync({ id: draft.id, categoryId });
      setJob(refreshed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  async function onSubmit() {
    setError(null);
    try {
      const draft = await ensureDraft();
      const res = await submit.mutateAsync(draft.id);
      router.replace({ pathname: '/(customer)/job/[id]', params: { id: res.job.id, duplicateOf: res.duplicateOf ?? '' } });
    } catch (e) {
      if (e instanceof ApiError) {
        const blockers = (e.details as { blockers?: string[] } | undefined)?.blockers;
        setError(blockers?.length ? blockerMessage(blockers[0]!) : e.message);
      } else setError(t('common.error'));
    }
  }

  const busy = createDraft.isPending || updateDraft.isPending || submit.isPending || attach.isPending;

  return (
    <Screen scroll={false} padded={false} style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text variant="heading" weight="bold">
          Book a service
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* category */}
        <Animated.View entering={FadeInDown.duration(380)}>
          <Text weight="semibold" style={styles.label}>
            What do you need?
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
            {categories.data?.items.map((c) => {
              const active = c.id === categoryId;
              return (
                <Pressable key={c.id} onPress={() => setCategoryId(c.id)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.cat, active && styles.catActive]}>
                  <RealisticIcon iconKey={c.iconKey} size={38} />
                  <Text variant="caption" weight={active ? 'bold' : 'medium'} style={active ? styles.catTextActive : undefined}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* description */}
        <Animated.View entering={FadeInDown.delay(80).duration(380)}>
          <Text weight="semibold" style={styles.label}>
            Describe the problem
          </Text>
          <View style={styles.textareaWrap}>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Kitchen tap has been leaking since morning"
              placeholderTextColor="#A9B8B1"
              multiline
              numberOfLines={4}
              maxLength={1500}
              accessibilityLabel="Describe the problem"
              style={styles.textarea}
            />
          </View>
          <Text variant="caption" tone="muted" style={styles.hint}>
            A few words or a photo is enough - providers need something to quote on.
          </Text>
        </Animated.View>

        {/* hazard warning */}
        {job?.hazards.map((h) => (
          <Animated.View key={h} entering={FadeIn.duration(280)} style={styles.hazard}>
            <Ionicons name="warning" size={20} color="#B42318" />
            <Text variant="caption" weight="medium" style={styles.hazardText}>
              {HAZARD_COPY[h] ?? 'This looks like an emergency. Please make sure everyone is safe first.'}
            </Text>
          </Animated.View>
        ))}

        {/* photos */}
        <Animated.View entering={FadeInDown.delay(140).duration(380)}>
          <Text weight="semibold" style={styles.label}>
            Photos <Text variant="caption" tone="muted">(optional)</Text>
          </Text>
          <View style={styles.photoRow}>
            {job?.media.filter((m) => m.kind === 'PHOTO').map((m) => (
              <View key={m.id} style={styles.photo}>
                {m.url.startsWith('http') ? <Image source={{ uri: m.url }} style={styles.photoImg} /> : <Ionicons name="image" size={26} color={palette.primary} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => job && removeMedia.mutate({ jobId: job.id, mediaId: m.id })}
                  style={styles.photoRemove}
                >
                  <Ionicons name="close" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Add a photo" onPress={addPhoto} style={styles.addPhoto}>
              <Ionicons name="camera-outline" size={24} color={palette.primary} />
              <Text variant="micro" weight="semibold" tone="primary">
                Add
              </Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* A voice note, for anybody who would rather say it than type it. */}
        <Animated.View entering={FadeInDown.delay(170).duration(380)}>
          <Text weight="semibold" style={styles.label}>
            Voice note <Text variant="caption" tone="muted">(optional)</Text>
          </Text>
          <VoiceNoteRecorder
            existing={job?.media.find((m) => m.kind === 'VOICE_NOTE') ?? null}
            onRecorded={(file) => void attachFile(file)}
            onRemove={() => {
              const note = job?.media.find((m) => m.kind === 'VOICE_NOTE');
              if (job && note) removeMedia.mutate({ jobId: job.id, mediaId: note.id });
            }}
            disabled={attach.isPending}
          />
        </Animated.View>

        {/* options */}
        <Animated.View entering={FadeInDown.delay(200).duration(380)} style={styles.toggles}>
          <Toggle icon="flash" label="Urgent" body="Get offers within 10 minutes" value={urgent} onChange={setUrgent} />
          <Toggle icon="cube-outline" label="Materials needed" body="Provider arranges parts" value={withMaterial} onChange={setWithMaterial} />
        </Animated.View>

        {/* when */}
        <Animated.View entering={FadeInDown.delay(260).duration(380)}>
          <Text weight="semibold" style={styles.label}>
            When?
          </Text>
          <View style={styles.slots}>
            {SLOTS.map((s) => {
              const active = s.key === slot;
              return (
                <Pressable key={s.key} onPress={() => setSlot(s.key)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.slot, active && styles.slotActive]}>
                  <Text variant="caption" weight="semibold" style={active ? styles.slotTextActive : undefined}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* address */}
        <Animated.View entering={FadeInDown.delay(320).duration(380)}>
          <Text weight="semibold" style={styles.label}>
            Where?
          </Text>
          {addresses.isPending ? (
            <Card padding="md">
              <Text variant="caption" tone="muted">
                Loading your addresses…
              </Text>
            </Card>
          ) : addresses.data?.items.length ? (
            <View style={styles.addresses}>
              {addresses.data.items.map((a) => {
                const active = a.id === addressId;
                return (
                  <Card key={a.id} onPress={() => setAddressId(a.id)} padding="md" style={[styles.address, active && styles.addressActive]} accessibilityLabel={a.label}>
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? palette.primary : palette.borderStrong} />
                    <View style={styles.addressText}>
                      <Text variant="label" weight="semibold">
                        {a.label}
                      </Text>
                      <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {a.line1}, {a.city} {a.pincode}
                      </Text>
                    </View>
                    {!a.inPilotZone && <Badge tone="warning" label="Outside zone" />}
                  </Card>
                );
              })}
            </View>
          ) : (
            <Card padding="md">
              <Text variant="caption" tone="secondary">
                Add an address in your profile to continue.
              </Text>
            </Card>
          )}
          {outOfZone && (
            <Text variant="caption" tone="danger" style={styles.hint}>
              We are not serving this address yet. Pick another one inside the pilot zone.
            </Text>
          )}
        </Animated.View>

        {error && (
          <Animated.View entering={FadeIn.duration(220)} style={styles.errorRow}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
              {error}
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* sticky footer */}
      <View style={styles.footer}>
        <Button
          title={urgent ? 'Get urgent offers' : 'Find providers'}
          fullWidth
          iconRight="arrow-forward"
          loading={busy}
          disabled={!canContinue}
          onPress={onSubmit}
        />
        <Text variant="micro" tone="muted" center style={styles.footerNote}>
          No payment yet - you compare offers first.
        </Text>
      </View>
    </Screen>
  );
}

function Toggle({ icon, label, body, value, onChange }: { icon: keyof typeof Ionicons.glyphMap; label: string; body: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Card onPress={() => onChange(!value)} padding="md" style={[styles.toggle, value && styles.toggleActive]} accessibilityLabel={label}>
      <LinearGradient colors={value ? ['#FFF1D2', '#FFE0A6'] : ['#EEF3F0', '#E4EDE9']} style={styles.toggleIcon}>
        <Ionicons name={icon} size={18} color={value ? '#E58E00' : palette.textSecondary} />
      </LinearGradient>
      <View style={styles.toggleText}>
        <Text variant="label" weight="semibold">
          {label}
        </Text>
        <Text variant="caption" tone="secondary">
          {body}
        </Text>
      </View>
      <Ionicons name={value ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={value ? palette.primary : palette.borderStrong} />
    </Card>
  );
}

function blockerMessage(code: string): string {
  switch (code) {
    case 'NEEDS_DESCRIPTION_OR_MEDIA':
      return 'Add a few more words or a photo so providers can quote.';
    case 'ADDRESS_OUT_OF_ZONE':
      return 'We are not serving that address yet.';
    case 'ADDRESS_MISSING':
      return 'Choose where the work is needed.';
    case 'CATEGORY_DISABLED':
      return 'That service is not available in your area yet.';
    case 'PROHIBITED_CONTENT':
      return "We can't help with this request.";
    case 'SCHEDULE_IN_PAST':
      return 'Pick a time in the future.';
    default:
      return 'Please check the details and try again.';
  }
}

const styles = StyleSheet.create({
  // bound the scroll area so the footer button stays pinned above the tab bar
  screen: { flex: 1 },
  scroll: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.screen, paddingBottom: spacing.md },
  body: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xxxl, gap: spacing.xl },
  label: { fontSize: 15, marginBottom: spacing.sm },
  hint: { marginTop: spacing.xs },

  catRow: { gap: spacing.md, paddingVertical: spacing.xs, paddingRight: spacing.lg },
  cat: { width: 92, minHeight: 96, borderRadius: radius.lg, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 2, borderColor: 'transparent' },
  catActive: { borderColor: palette.primary, backgroundColor: '#F4FCF8' },
  catTextActive: { color: palette.primaryDeep },

  textareaWrap: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E4EDE9', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  textarea: { minHeight: 92, fontSize: 15, color: palette.text, textAlignVertical: 'top' },

  hazard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: '#FEF3F2', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#FDA29B' },
  hazardText: { color: '#B42318', flex: 1 },

  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  photo: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  photoImg: { width: 72, height: 72, borderRadius: radius.md },
  photoRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.danger, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 72, height: 72, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.primary, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: '#F4FCF8' },

  toggles: { gap: spacing.md },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 2, borderColor: 'transparent' },
  toggleActive: { borderColor: palette.primary },
  toggleIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  toggleText: { flex: 1 },

  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: { paddingHorizontal: spacing.lg, minHeight: 42, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: palette.surface },
  slotActive: { backgroundColor: palette.primary },
  slotTextActive: { color: '#FFFFFF' },

  addresses: { gap: spacing.sm },
  address: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 2, borderColor: 'transparent' },
  addressActive: { borderColor: palette.primary },
  addressText: { flex: 1 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // the CTA sits above the floating tab bar, never behind it
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: layout.tabBarHeight + layout.tabBarMargin * 2,
    backgroundColor: palette.ground,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  footerNote: { marginTop: spacing.sm },
});
