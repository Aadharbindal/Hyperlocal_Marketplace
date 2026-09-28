import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ApiError } from '@/api/client';
import { useDeleteAccount } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, Screen, Spacer, Text, TextField } from '@/ui';

/**
 * Closing an account, from inside the app.
 *
 * Both app stores require an account created in an app to be deletable from that app, and this
 * being missing would have been a review rejection rather than a missing nicety. The API side has
 * existed since the trust work - a 30-day scheduled anonymisation - and had no way to reach it.
 *
 * The screen is written to be honest rather than to retain: what goes, what stays and why it
 * stays are all stated before the button, not after. The typed confirmation is there because this
 * is the one action in the app that a mis-tap cannot undo.
 */
export default function DeleteAccountScreen() {
  const t = useStrings();
  const router = useRouter();
  const del = useDeleteAccount();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const armed = confirm.trim().toUpperCase() === 'DELETE';

  const submit = async () => {
    setError(null);
    try {
      const res = await del.mutateAsync();
      // The hook has already signed out by the time this runs, so the gate is about to send this
      // screen back to the phone entry. Showing the date first is what makes "scheduled" mean
      // something rather than the app just vanishing out from under somebody.
      setScheduledFor(new Date(res.scheduledFor).toLocaleDateString());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  if (scheduledFor) {
    return (
      <Screen>
        <Spacer h={spacing.huge} />
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={30} color={palette.primaryDeep} />
        </View>
        <Spacer h={spacing.lg} />
        <Text variant="heading" center>
          {t('deleteAccount.done')}
        </Text>
        <Spacer h={spacing.sm} />
        <Text variant="body" tone="secondary" center>
          {scheduledFor}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          {t('deleteAccount.title')}
        </Text>
      </View>
      <Spacer h={spacing.xl} />

      <Card style={styles.warnCard}>
        <View style={styles.warnIcon}>
          <Ionicons name="alert-circle" size={20} color={palette.danger} />
        </View>
        <Text variant="label" weight="semibold" style={styles.warnText}>
          {t('deleteAccount.warning')}
        </Text>
      </Card>

      <Spacer h={spacing.xl} />

      {/* Said plainly, because somebody deleting an account is entitled to know that "delete"
          does not mean every trace is gone - and finding that out later, from a receipt they did
          not expect to still exist, is far worse than reading it here. */}
      <Text variant="subheading" weight="bold">
        What we keep
      </Text>
      <Spacer h={spacing.sm} />
      <Text variant="caption" tone="secondary">
        Your name, number, email, photo and addresses are removed. Invoices, payments and dispute
        records are kept for as long as the law requires, with your name taken off them.
      </Text>

      <Spacer h={spacing.xxl} />

      <TextField
        label={t('deleteAccount.confirmLabel')}
        value={confirm}
        onChangeText={setConfirm}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={10}
      />

      {error ? (
        <>
          <Spacer h={spacing.lg} />
          <Text variant="caption" tone="danger" center>
            {error}
          </Text>
        </>
      ) : null}

      <Spacer h={spacing.xxl} />
      <Button
        title={t('deleteAccount.cta')}
        variant="danger"
        fullWidth
        icon="trash-outline"
        disabled={!armed}
        loading={del.isPending}
        onPress={submit}
      />
      <Spacer h={spacing.md} />
      <Button title={t('common.cancel')} variant="ghost" size="md" fullWidth onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  warnCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: palette.dangerSoft },
  warnIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  warnText: { flex: 1 },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
