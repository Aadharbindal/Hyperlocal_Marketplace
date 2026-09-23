import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { checkPayoutAccount, type PayoutAccountBody } from '@hyperlocal/core';
import { usePayoutAccount, useSetPayoutAccount } from '@/api/finance';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Screen, Spacer, Text, TextField } from '@/ui';

/**
 * Where a provider or vendor gets paid. Shared by both, because the question is the same one.
 *
 * The details are typed once, sent once, and never kept on the device: what comes back is a
 * masked view, which is all anyone needs to recognise their own account.
 */

const BLOCKER_MESSAGE: Record<string, string> = {
  NAME_TOO_SHORT: 'Enter the full name on the account',
  BAD_ACCOUNT_NUMBER: 'An account number is 9 to 18 digits, no spaces',
  BAD_IFSC: 'An IFSC is 11 characters, like HDFC0001234',
  BAD_UPI_ID: 'A UPI id looks like name@bank',
};

export default function PayoutAccountScreen() {
  const router = useRouter();
  const existing = usePayoutAccount();
  const save = useSetPayoutAccount();

  const [method, setMethod] = useState<'UPI' | 'BANK_ACCOUNT'>('UPI');
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const body: PayoutAccountBody =
    method === 'UPI'
      ? { method: 'UPI', accountHolderName: name.trim(), vpa: vpa.trim() }
      : { method: 'BANK_ACCOUNT', accountHolderName: name.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase() };

  // The same rules the server uses, so a typo is caught before it becomes a failed payout.
  const blocker = checkPayoutAccount(body);

  async function submit() {
    setError(null);
    if (blocker) {
      setError(BLOCKER_MESSAGE[blocker] ?? 'Check these details');
      return;
    }
    try {
      await save.mutateAsync(body);
      router.back();
    } catch {
      setError('We could not verify this account. Check the details and try again.');
    }
  }

  return (
    <Screen keyboard>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          Where you get paid
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {existing.data ? (
        <Card style={styles.current}>
          <View style={styles.currentRow}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="secondary">
                Paying into
              </Text>
              <Text variant="label" weight="semibold">
                {existing.data.method === 'UPI' ? existing.data.masked : `${existing.data.masked} · ${existing.data.ifsc ?? ''}`}
              </Text>
              <Text variant="micro" tone="muted">
                {existing.data.accountHolderName}
              </Text>
            </View>
            <Badge
              tone={existing.data.readyForPayouts ? 'success' : 'warning'}
              label={existing.data.readyForPayouts ? 'active' : 'checking'}
            />
          </View>
          <Text variant="micro" tone="muted">
            Adding new details below replaces these. Money already on its way is not affected.
          </Text>
        </Card>
      ) : (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={palette.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            Your earnings are held safely until you add these details. Nothing is lost while you wait.
          </Text>
        </View>
      )}

      <Spacer h={spacing.lg} />
      <View style={styles.tabs}>
        {(['UPI', 'BANK_ACCOUNT'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setMethod(m);
              setError(null);
            }}
            style={[styles.tab, method === m && styles.tabActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: method === m }}
          >
            <Text variant="label" weight="semibold" style={method === m ? { color: palette.primary } : { color: palette.textMuted }}>
              {m === 'UPI' ? 'UPI' : 'Bank account'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Spacer h={spacing.md} />
      <TextField
        label="Name on the account"
        value={name}
        onChangeText={setName}
        placeholder="As printed in your bank records"
        autoCapitalize="words"
        icon="person-outline"
      />

      {method === 'UPI' ? (
        <TextField
          label="UPI id"
          value={vpa}
          onChangeText={setVpa}
          placeholder="name@bank"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          icon="at-outline"
        />
      ) : (
        <>
          <TextField
            label="Account number"
            value={accountNumber}
            onChangeText={(v) => setAccountNumber(v.replace(/\D/g, ''))}
            placeholder="9 to 18 digits"
            keyboardType="number-pad"
            icon="card-outline"
          />
          <TextField
            label="IFSC"
            value={ifsc}
            onChangeText={(v) => setIfsc(v.toUpperCase())}
            placeholder="HDFC0001234"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={11}
            icon="business-outline"
          />
        </>
      )}

      {error ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {error}
        </Text>
      ) : null}

      <Spacer h={spacing.md} />
      <Button title={existing.data ? 'Replace these details' : 'Save and get paid'} onPress={() => void submit()} loading={save.isPending} fullWidth />

      <Spacer h={spacing.md} />
      <View style={styles.note}>
        <Ionicons name="lock-closed-outline" size={14} color={palette.textMuted} />
        <Text variant="micro" tone="muted" style={{ flex: 1 }}>
          These details go straight to our payments partner. We keep only the last four digits, so we can
          show you which account is yours.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  current: { gap: spacing.sm },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm },
  tabActive: { backgroundColor: palette.surface },
});
