import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ApiError } from '@/api/client';
import { useEnableMfa, useMfaStatus, useStartMfa, useVerifyMfa } from '@/api/admin';
import { palette, radius, spacing, typography } from '@/theme';
import { Button, Card, Skeleton, Text } from '@/ui';

/**
 * Wraps every console screen. Staff can see identity documents and move money, so a stolen
 * phone number is not enough to get in: a second factor is required and it goes stale after a
 * shift (SECURITY_CHECKLIST).
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const status = useMfaStatus();
  const start = useStartMfa();
  const enable = useEnableMfa();
  const verify = useVerifyMfa();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (status.isPending) {
    return (
      <Card style={styles.card}>
        <Skeleton height={18} width="50%" />
        <Skeleton height={60} />
      </Card>
    );
  }

  // The requirement is a setting, so a local demo stays usable; /ready reports when it is off.
  if (status.data && !status.data.requiredForAdmin && status.data.verifiedForSession) return <>{children}</>;
  if (status.data?.verifiedForSession) return <>{children}</>;
  if (status.data && !status.data.requiredForAdmin && !status.data.enrolled) {
    return (
      <>
        <View style={styles.warn}>
          <Ionicons name="warning-outline" size={15} color="#B26A00" />
          <Text variant="micro" style={{ color: '#7A5200', flex: 1 }}>
            Two-factor is switched off for this environment. It is mandatory in production.
          </Text>
        </View>
        {children}
      </>
    );
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError ? mfaError(e) : 'Something went wrong.');
    }
  }

  const enrolled = status.data?.enrolled ?? false;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="shield-checkmark" size={20} color={palette.primaryDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="semibold">
            {enrolled ? 'Enter your code' : 'Set up two-factor'}
          </Text>
          <Text variant="micro" tone="muted">
            {enrolled ? 'From your authenticator app' : 'Scan this into an authenticator app'}
          </Text>
        </View>
      </View>

      {!enrolled && !secret && (
        <Button title="Start setup" fullWidth loading={start.isPending} onPress={() => void run(async () => setSecret((await start.mutateAsync()).secret))} />
      )}

      {secret && (
        <View style={styles.secretBox}>
          <Text variant="micro" tone="muted">
            Setup key — shown once, never again
          </Text>
          <Text weight="bold" style={styles.secret} selectable>
            {secret.match(/.{1,4}/g)?.join(' ')}
          </Text>
        </View>
      )}

      {(enrolled || secret) && (
        <>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor="#A9B8B1"
            style={styles.input}
            accessibilityLabel="Six digit code"
          />
          <Button
            title={enrolled ? 'Verify' : 'Turn it on'}
            fullWidth
            loading={enable.isPending || verify.isPending}
            onPress={() => void run(() => (enrolled ? verify.mutateAsync(code) : enable.mutateAsync(code).then(() => setSecret(null))))}
          />
        </>
      )}

      {error && (
        <Animated.View entering={FadeIn.duration(180)}>
          <Text variant="caption" style={{ color: palette.danger }}>
            {error}
          </Text>
        </Animated.View>
      )}

      <Pressable accessibilityRole="button" onPress={() => void status.refetch()} style={styles.refresh}>
        <Text variant="micro" weight="semibold" tone="muted">
          Refresh status
        </Text>
      </Pressable>
    </Card>
  );
}

function mfaError(e: ApiError): string {
  const first = (e.details as { admin?: string[] } | undefined)?.admin?.[0];
  const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
  switch (first) {
    case 'WRONG_CODE':
      return `That code is wrong. ${left ?? 0} attempts left.`;
    case 'CODE_REUSED':
      return 'That code was already used. Wait for the next one.';
    case 'MFA_LOCKED':
      return 'Too many wrong codes. Try again in a few minutes.';
    case 'MFA_NOT_ENROLLED':
      return 'Set up two-factor first.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  secretBox: { backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md, gap: 4 },
  secret: { fontSize: 17, letterSpacing: 1.5, color: palette.text },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 8,
    fontFamily: typography.family.bold,
    color: palette.text,
  },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF6E0', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  refresh: { alignItems: 'center', minHeight: 32, justifyContent: 'center' },
});
