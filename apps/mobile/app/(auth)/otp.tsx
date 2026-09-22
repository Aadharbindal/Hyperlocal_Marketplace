import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { maskPhone } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useRequestOtp, useVerifyOtp } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, IconButton, Screen, Spacer, Text } from '@/ui';

const LENGTH = 6;

export default function OtpScreen() {
  const t = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string; challengeId: string; expires: string; demoCode?: string }>();
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [demoCode, setDemoCode] = useState(params.demoCode || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(60);
  const input = useRef<TextInput>(null);
  const verify = useVerifyOtp();
  const resend = useRequestOtp();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submit = async (value = code) => {
    if (value.length !== LENGTH) return;
    setError(null);
    try {
      await verify.mutateAsync({ challengeId, code: value });
      // AuthGate redirects to the right place once /me resolves.
    } catch (err) {
      if (err instanceof ApiError) {
        const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
        setError(remaining !== undefined ? `${err.message} (${remaining} left)` : err.message);
        if (err.code === 'OTP_LOCKED' || err.code === 'OTP_EXPIRED' || err.code === 'OTP_CONSUMED') setCooldown(0);
      } else setError(t('common.error'));
      setCode('');
    }
  };

  const onResend = async () => {
    try {
      const res = await resend.mutateAsync(params.phone);
      setChallengeId(res.challengeId);
      setDemoCode(res.demoCode ?? '');
      setCooldown(res.resendAfterSeconds);
      setError(null);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen keyboard>
      <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => router.back()} />
      <Spacer h={spacing.xxl} />
      <Text variant="display">{t('auth.otp.title')}</Text>
      <Text variant="body" tone="secondary">
        {t('auth.otp.subtitle')} {maskPhone(params.phone)}
      </Text>
      <Spacer h={spacing.xxxl} />

      <Pressable onPress={() => input.current?.focus()} accessibilityLabel="One-time code" accessibilityRole="none">
        <View style={styles.boxes}>
          {Array.from({ length: LENGTH }).map((_, i) => {
            const ch = code[i] ?? '';
            const active = i === code.length;
            return (
              <View key={i} style={[styles.box, active && styles.boxActive, error && styles.boxError]}>
                <Text variant="title">{ch}</Text>
              </View>
            );
          })}
        </View>
        <TextInput
          ref={input}
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, LENGTH);
            setCode(digits);
            if (digits.length === LENGTH) void submit(digits);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={LENGTH}
          style={styles.hidden}
          caretHidden
        />
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger" center style={styles.msg}>
          {error}
        </Text>
      ) : null}

      {demoCode ? (
        <View style={styles.demo}>
          <Badge tone="warning" icon="flask-outline" label={`${t('auth.otp.demo')} ${demoCode}`} />
        </View>
      ) : null}

      <Spacer h={spacing.xxl} />
      <Button title={t('auth.otp.cta')} fullWidth loading={verify.isPending} disabled={code.length !== LENGTH} onPress={() => submit()} />
      <Spacer h={spacing.lg} />
      {cooldown > 0 ? (
        <Text variant="label" tone="muted" center>
          {t('auth.otp.resendIn')} 0:{String(cooldown).padStart(2, '0')}
        </Text>
      ) : (
        <Button title={t('auth.otp.resend')} variant="ghost" size="md" style={styles.center} loading={resend.isPending} onPress={onResend} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: { flex: 1, height: 60, borderRadius: radius.md, backgroundColor: palette.surfaceMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  boxActive: { borderColor: palette.primary, backgroundColor: palette.surface },
  boxError: { borderColor: palette.danger },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1, fontSize: typography.size.body },
  msg: { marginTop: spacing.md },
  demo: { alignItems: 'center', marginTop: spacing.md },
  center: { alignSelf: 'center' },
});
