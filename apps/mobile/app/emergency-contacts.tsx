import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { EMERGENCY_CONTACT_LIMIT, checkMobileField, checkPersonName } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAddEmergencyContact, useEmergencyContacts, useRemoveEmergencyContact } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, EmptyState, ErrorState, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

/**
 * Who to reach if a visit goes wrong.
 *
 * The framing throughout is deliberate: this is not "share your contacts", it is a short list the
 * customer types, and the screen says out loud that nobody here is contacted unless the customer
 * asks. Those people have not agreed to be in anybody's database, and a feature that quietly
 * harvested an address book would be the single worst thing in this app.
 */
export default function EmergencyContactsScreen() {
  const t = useStrings();
  const router = useRouter();
  const list = useEmergencyContacts();
  const add = useAddEmergencyContact();
  const remove = useRemoveEmergencyContact();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = list.data?.items ?? [];
  const canAdd = !checkPersonName(name) && !!name.trim() && !checkMobileField(phone) && !!phone.trim();
  const full = items.length >= EMERGENCY_CONTACT_LIMIT;
  const enter = (i: number) => (reduced ? undefined : FadeInDown.delay(i * 60).duration(380));

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
      });
      setName('');
      setPhone('');
      setRelationship('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen keyboard refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          {t('emergency.title')}
        </Text>
      </View>
      <Spacer h={spacing.md} />
      <Text variant="caption" tone="secondary">
        {t('emergency.intro')}
      </Text>
      <Spacer h={spacing.xl} />

      {list.isPending ? (
        <View style={styles.list}>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : list.isError ? (
        <ErrorState title={t('common.loadFailed')} onRetry={() => void list.refetch()} retrying={list.isRefetching} />
      ) : items.length === 0 && !open ? (
        <EmptyState
          icon="shield-outline"
          title={t('emergency.empty')}
          body={t('emergency.empty.body')}
          actionLabel={t('emergency.add')}
          onAction={() => setOpen(true)}
        />
      ) : (
        <View style={styles.list}>
          {items.map((c, i) => (
            <Animated.View key={c.id} entering={enter(i)}>
              <Card style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="person" size={19} color={palette.chip.rose.fg} />
                </View>
                <View style={styles.rowText}>
                  <Text variant="label" weight="semibold">
                    {c.name}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {c.relationship ? `${c.relationship} · ${c.phoneMasked}` : c.phoneMasked}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void remove.mutateAsync(c.id)}
                  accessibilityRole="button"
                  // Named with the contact, so a screen reader moving down a list of three
                  // "Remove" buttons can tell which one is which.
                  accessibilityLabel={`${t('emergency.remove')} ${c.name}`}
                  hitSlop={8}
                  style={styles.removeBtn}
                >
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                </Pressable>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      {open ? (
        <Animated.View entering={reduced ? undefined : FadeInDown.duration(300)}>
          <Spacer h={spacing.lg} />
          <Card style={styles.form}>
            <TextField label={t('emergency.name')} value={name} onChangeText={setName} icon="person-outline" autoCapitalize="words" maxLength={60} validate={checkPersonName} />
            <TextField
              label={t('emergency.phone')}
              value={phone}
              onChangeText={setPhone}
              icon="call-outline"
              prefix="+91"
              keyboardType="phone-pad"
              maxLength={13}
              // The one field on this screen where a typo has a cost nobody finds out about until
              // it matters: a wrong digit here is a contact who is simply never reached.
              validate={checkMobileField}
            />
            <TextField
              label={t('emergency.relationship')}
              placeholder={t('emergency.relationship.placeholder')}
              value={relationship}
              onChangeText={setRelationship}
              icon="heart-outline"
              maxLength={40}
            />
            {error ? (
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            ) : null}
            <View style={styles.formActions}>
              <Button title={t('common.cancel')} variant="ghost" size="md" onPress={() => setOpen(false)} />
              {/* A name and a number are the whole of what this needs, so the button waits for
                  them rather than offering a save that the server will refuse. The two fields say
                  what is wrong with what is there; the button only says whether there is enough. */}
              <Button
                title={t('emergency.add')}
                size="md"
                loading={add.isPending}
                disabled={!canAdd}
                onPress={submit}
              />
            </View>
          </Card>
        </Animated.View>
      ) : items.length > 0 ? (
        <>
          <Spacer h={spacing.xl} />
          <Button
            title={t('emergency.add')}
            variant="secondary"
            size="md"
            fullWidth
            icon="add"
            // Greyed at the cap rather than hidden, so the limit is something the screen states
            // instead of a button that mysteriously is not there.
            disabled={full}
            onPress={() => setOpen(true)}
          />
          {full ? (
            <>
              <Spacer h={spacing.sm} />
              <Text variant="micro" tone="muted" center>
                {t('error.CONTACT_LIMIT_REACHED')}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.chip.rose.bg, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  removeBtn: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  form: { gap: spacing.lg },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
