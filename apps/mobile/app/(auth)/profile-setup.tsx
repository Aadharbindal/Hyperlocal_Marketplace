import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { CURRENT_TERMS_VERSION } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useCompleteProfile } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, radius, spacing } from '@/theme';
import { Button, Screen, Spacer, Text, TextField } from '@/ui';

/**
 * The one screen that runs between the OTP and the rest of the app, for an account that has just
 * come into existence.
 *
 * Before this existed, signing up produced a row with a phone number and nothing else: the
 * profile showed a masked number, the home screen said "Good evening," to nobody, and the
 * provider arriving at somebody's door had no name to ask for. The name field had been in the
 * schema the whole time - it was simply never asked for.
 *
 * Only the name is required. Email is genuinely optional, because a large share of the people
 * this app is for do not use one, and a mandatory email would be a wall in front of the door for
 * exactly the customers we most want through it.
 */
export default function ProfileSetupScreen() {
  const t = useStrings();
  const reduced = useReducedMotion();
  const user = useSession((s) => s.user);
  const language = useSession((s) => s.language);
  const complete = useCompleteProfile();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string }>({});

  const enter = (i: number) => (reduced ? undefined : FadeInDown.delay(i * 80).duration(420));

  const submit = async () => {
    setError(null);
    setFieldError({});
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFieldError({ name: t('setup.nameRequired') });
      return;
    }
    if (!terms) {
      setError(t('setup.termsRequired'));
      return;
    }
    try {
      await complete.mutateAsync({
        displayName: trimmed,
        // Sent only when there is something to send: an empty string is not an address, and the
        // API would rightly reject it.
        ...(email.trim() ? { email: email.trim() } : {}),
        preferredLanguage: language,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
        marketingOptIn: marketing,
      });
      // No navigation here. The gate in _layout watches `displayName` and moves on by itself,
      // which keeps one place deciding where somebody belongs.
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') setFieldError({ email: err.message });
      else setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen keyboard>
      <Spacer h={spacing.xxl} />

      <Animated.View entering={enter(0)}>
        <View style={styles.badge}>
          <Ionicons name="person" size={28} color={palette.primaryDeep} />
        </View>
        <Spacer h={spacing.lg} />
        <Text variant="display">{t('setup.title')}</Text>
        <Text variant="body" tone="secondary">
          {t('setup.subtitle')}
        </Text>
      </Animated.View>

      <Spacer h={spacing.xxl} />

      <Animated.View style={styles.fields} entering={enter(1)}>
        <TextField
          label={t('setup.name')}
          placeholder={t('setup.name.placeholder')}
          icon="person-outline"
          value={name}
          onChangeText={setName}
          error={fieldError.name}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          maxLength={60}
        />
        <TextField
          label={t('setup.email')}
          helper={t('setup.email.hint')}
          placeholder="you@example.com"
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          error={fieldError.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          maxLength={254}
        />
      </Animated.View>

      <Spacer h={spacing.xl} />

      <Animated.View style={styles.checks} entering={enter(2)}>
        <Check checked={terms} onToggle={() => setTerms((v) => !v)} label={t('setup.terms')} />
        <Check checked={marketing} onToggle={() => setMarketing((v) => !v)} label={t('setup.marketing')} />
      </Animated.View>

      {error ? (
        <Text variant="caption" tone="danger" center style={styles.msg}>
          {error}
        </Text>
      ) : null}

      <Spacer h={spacing.xxl} />
      <Animated.View entering={enter(3)}>
        <Button title={t('setup.cta')} fullWidth iconRight="arrow-forward" loading={complete.isPending} onPress={submit} />
      </Animated.View>
      <Spacer h={spacing.md} />
      <Text variant="micro" tone="muted" center>
        {user?.phoneMasked}
      </Text>
    </Screen>
  );
}

/**
 * A checkbox with the label inside the same touch target.
 *
 * Written rather than pulled from the UI kit because there was no checkbox in it - every other
 * screen in this app takes a choice with a chip or a switch. The whole row is pressable: a 20pt
 * box is below the minimum target on its own, and people tap words, not squares.
 */
function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessible
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={6}
      style={styles.check}
    >
      <View style={[styles.box, checked && styles.boxOn]} importantForAccessibility="no-hide-descendants">
        {checked ? <Ionicons name="checkmark" size={15} color={palette.textOnPrimary} /> : null}
      </View>
      <Text variant="caption" tone="secondary" style={styles.checkLabel} importantForAccessibility="no-hide-descendants">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { gap: spacing.lg },
  checks: { gap: spacing.md },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  checkLabel: { flex: 1 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  msg: { marginTop: spacing.lg },
});
