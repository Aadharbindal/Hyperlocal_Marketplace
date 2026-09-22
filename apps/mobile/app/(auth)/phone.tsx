import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { normaliseIndianPhone } from '@hyperlocal/core';
import { useRequestOtp } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Button, Screen, Spacer, Text, TextField } from '@/ui';

export default function PhoneScreen() {
  const t = useStrings();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const request = useRequestOtp();

  const submit = async () => {
    const e164 = normaliseIndianPhone(phone);
    if (!e164) {
      setError('Enter a valid 10-digit Indian mobile number');
      return;
    }
    setError(null);
    try {
      const res = await request.mutateAsync(e164);
      router.push({ pathname: '/(auth)/otp', params: { phone: e164, challengeId: res.challengeId, expires: String(res.expiresInSeconds), demoCode: res.demoCode ?? '' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen keyboard>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Ionicons name="home" size={30} color={palette.textOnPrimary} />
        </View>
        <Text variant="display">{t('auth.phone.title')}</Text>
        <Text variant="body" tone="secondary">
          {t('auth.phone.subtitle')}
        </Text>
      </View>
      <Spacer h={spacing.xxxl} />
      <TextField
        label="Mobile number"
        prefix="+91"
        placeholder={t('auth.phone.placeholder')}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        maxLength={12}
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          if (error) setError(null);
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        helper={t('auth.phone.helper')}
        error={error}
      />
      <Spacer h={spacing.xxl} />
      <Button title={t('auth.phone.cta')} fullWidth iconRight="arrow-forward" loading={request.isPending} onPress={submit} />
      <View style={styles.footer}>
        <Text variant="caption" tone="muted" center>
          {t('brand.tagline')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginTop: spacing.huge, gap: spacing.sm },
  logo: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  footer: { marginTop: 'auto', paddingTop: spacing.xxl },
});
