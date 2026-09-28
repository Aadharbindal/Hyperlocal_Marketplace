import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ApiError } from '@/api/client';
import { useMe, useRemoveAvatar, useUpdateMe, useUploadAvatar } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, Screen, Spacer, Text, TextField } from '@/ui';

/** What the picker hands back, mapped to the three types the API will accept. */
function mimeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = (uri.split('?')[0] ?? '').split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  // Everything a camera produces and most of what a gallery holds. Guessing jpeg is right far
  // more often than it is wrong, and the API checks the bytes it is sent regardless.
  return 'image/jpeg';
}

export default function EditProfileScreen() {
  const t = useStrings();
  const router = useRouter();
  const me = useMe();
  const user = useSession((s) => s.user);
  const update = useUpdateMe();
  const upload = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const reduced = useReducedMotion();

  const [name, setName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string }>({});
  const [saved, setSaved] = useState(false);

  const enter = (i: number) => (reduced ? undefined : FadeInDown.delay(i * 70).duration(400));
  const busy = update.isPending || upload.isPending || removeAvatar.isPending;

  const pick = async () => {
    setError(null);
    // Asked at the moment the person presses the button, not on mount: a permission sheet that
    // appears for a screen somebody is only reading is how people learn to press Deny.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // Square, because every place this is shown is a circle.
      aspect: [1, 1],
      quality: 0.8,
    });
    if (res.canceled || !res.assets[0]) return;
    try {
      await upload.mutateAsync({ uri: res.assets[0].uri, mime: mimeFor(res.assets[0].uri) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  const save = async () => {
    setError(null);
    setFieldError({});
    setSaved(false);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFieldError({ name: t('setup.nameRequired') });
      return;
    }
    try {
      await update.mutateAsync({
        displayName: trimmed,
        // An emptied field means "remove it", which is a real thing to want and is why the API
        // takes null here rather than treating absence as no-change-and-also-no-way-to-clear.
        email: email.trim() ? email.trim() : null,
      });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') setFieldError({ email: err.message });
      else setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen keyboard>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          {t('editProfile.title')}
        </Text>
      </View>
      <Spacer h={spacing.xl} />

      <Animated.View entering={enter(0)} style={styles.photoBlock}>
        <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel={t('editProfile.change')} disabled={busy}>
          <View style={styles.avatar}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} accessibilityIgnoresInvertColors />
            ) : (
              <Ionicons name="person-outline" size={40} color={palette.primaryDeep} />
            )}
          </View>
          {/* The camera badge is what tells somebody the circle is a button at all. */}
          <View style={styles.cameraBadge} importantForAccessibility="no-hide-descendants">
            <Ionicons name="camera" size={15} color={palette.textOnPrimary} />
          </View>
        </Pressable>
        <View style={styles.photoActions}>
          <Button title={t('editProfile.change')} variant="secondary" size="sm" onPress={pick} loading={upload.isPending} />
          {user?.avatarUrl ? (
            <Button title={t('editProfile.remove')} variant="ghost" size="sm" onPress={() => void removeAvatar.mutateAsync()} loading={removeAvatar.isPending} />
          ) : null}
        </View>
      </Animated.View>

      <Spacer h={spacing.xxl} />

      <Animated.View style={styles.fields} entering={enter(1)}>
        <TextField
          label={t('setup.name')}
          value={name}
          onChangeText={setName}
          error={fieldError.name}
          icon="person-outline"
          autoCapitalize="words"
          maxLength={60}
        />
        <TextField
          label={t('setup.email')}
          helper={t('setup.email.hint')}
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          error={fieldError.email}
          icon="mail-outline"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          maxLength={254}
        />
        {/* Shown only when there is an address to be unconfirmed about. A tick nobody can earn
            yet would be a promise the app does not keep: confirmation is not built. */}
        {user?.email && !user.emailVerified ? <Badge tone="warning" icon="alert-circle" label={t('editProfile.unverified')} /> : null}
      </Animated.View>

      <Spacer h={spacing.xl} />

      {/* Read-only, and visibly so. The number is the account's identity - changing it is a
          support-mediated action, not a text field. */}
      <Animated.View entering={enter(2)}>
        <Card style={styles.phoneCard}>
          <Ionicons name="call-outline" size={20} color={palette.textMuted} />
          <View style={styles.phoneText}>
            <Text variant="label" weight="semibold">
              {user?.phoneMasked}
            </Text>
            <Text variant="micro" tone="muted">
              {t('editProfile.phone.hint')}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={20} color={palette.primary} />
        </Card>
      </Animated.View>

      {error ? (
        <Text variant="caption" tone="danger" center style={styles.msg}>
          {error}
        </Text>
      ) : saved ? (
        <Text variant="caption" tone="success" center style={styles.msg} accessibilityLiveRegion="polite">
          {t('editProfile.saved')}
        </Text>
      ) : null}

      <Spacer h={spacing.xxl} />
      <Button title={t('editProfile.save')} fullWidth icon="checkmark" loading={update.isPending} disabled={me.isPending} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  photoBlock: { alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: palette.ground,
  },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fields: { gap: spacing.lg },
  phoneCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  phoneText: { flex: 1, gap: 1 },
  msg: { marginTop: spacing.lg },
});
