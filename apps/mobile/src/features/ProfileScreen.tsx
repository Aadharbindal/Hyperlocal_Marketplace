import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Language, UserRole } from '@hyperlocal/core';
import { useLogout, useMe, useUpdateMe } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, radius, spacing } from '@/theme';
import { Avatar, Badge, Button, Card, ErrorState, Screen, Skeleton, Spacer, Text } from '@/ui';

const VERIFICATION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  VERIFIED: 'success',
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'warning',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  UNVERIFIED: 'neutral',
};

/** Shared profile screen for every role group. */
export function ProfileScreen() {
  const t = useStrings();
  const router = useRouter();
  const me = useMe();
  const user = useSession((s) => s.user);
  const activeRole = useSession((s) => s.activeRole);
  const setActiveRole = useSession((s) => s.setActiveRole);
  const language = useSession((s) => s.language);
  const setLanguage = useSession((s) => s.setLanguage);
  const updateMe = useUpdateMe();
  const logout = useLogout();

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    updateMe.mutate({ preferredLanguage: l });
  };

  const roles = user?.roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role) ?? [];
  const verification = me.data?.profiles.provider?.verificationStatus ?? me.data?.profiles.vendor?.verificationStatus ?? me.data?.profiles.contractor?.verificationStatus;

  return (
    <Screen withTabBar refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <Text variant="title">{t('tabs.profile')}</Text>
      <Spacer />
      <Card style={styles.identity}>
        <Avatar name={user?.displayName} size={64} />
        <View style={styles.identityText}>
          <Text variant="heading">{user?.displayName ?? user?.phoneMasked ?? ''}</Text>
          <Text variant="caption" tone="secondary">
            {user?.phoneMasked}
          </Text>
          {user?.status === 'SUSPENDED' ? <Badge tone="danger" icon="alert-circle" label={t('error.AUTH_SUSPENDED')} /> : null}
        </View>
      </Card>

      {me.isPending ? (
        <View style={styles.section}>
          <Skeleton height={20} width="40%" />
          <Skeleton height={56} />
        </View>
      ) : me.isError ? (
        <ErrorState title={t('common.loadFailed')} onRetry={() => void me.refetch()} retrying={me.isRefetching} />
      ) : (
        <>
          {verification ? (
            <View style={styles.section}>
              <Text variant="subheading">{t('profile.verification')}</Text>
              <Badge tone={VERIFICATION_TONE[verification] ?? 'neutral'} icon="shield-checkmark" label={verification.replace('_', ' ')} />
            </View>
          ) : null}

          <View style={styles.section}>
            <Text variant="subheading">{t('profile.roles')}</Text>
            <View style={styles.roles}>
              {roles.map((r) => {
                const active = r === activeRole;
                return (
                  <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => void setActiveRole(r as UserRole)} style={[styles.roleChip, active && styles.roleChipActive]}>
                    <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? palette.textOnPrimary : palette.primary} />
                    <Text variant="label" weight="semibold" style={{ color: active ? palette.textOnPrimary : palette.primaryDeep }}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </>
      )}

      <View style={styles.section}>
        <Text variant="subheading">{t('profile.language')}</Text>
        <View style={styles.roles}>
          {(['en', 'hi'] as const).map((l) => (
            <Pressable key={l} accessibilityRole="button" accessibilityState={{ selected: language === l }} onPress={() => changeLanguage(l)} style={[styles.roleChip, language === l && styles.roleChipActive]}>
              <Text variant="label" weight="semibold" style={{ color: language === l ? palette.textOnPrimary : palette.primaryDeep }}>
                {l === 'en' ? 'English' : 'हिन्दी'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Everything else a person owns, in one place. Shown per role, because a vendor has no
          use for a list of saved plumbers. */}
      <View style={styles.section}>
        <Text variant="subheading">{t('settings.account')}</Text>
        <Card style={styles.links}>
          <Link icon="notifications-outline" label={t('settings.notifications')} onPress={() => router.push('/notification-settings')} />
          {activeRole === 'CUSTOMER' ? (
            <>
              <Link icon="receipt-outline" label={t('settings.receipts')} onPress={() => router.push('/receipts')} />
              <Link icon="heart-outline" label={t('settings.saved')} onPress={() => router.push('/favourites')} />
            </>
          ) : null}
          <Link icon="gift-outline" label={t('settings.invite')} onPress={() => router.push('/referrals')} last />
        </Card>
      </View>

      <Spacer h={spacing.xxl} />
      <Button title={t('profile.signOut')} variant="danger" size="md" icon="log-out-outline" loading={logout.isPending} onPress={() => logout.mutate()} />
    </Screen>
  );
}

function Link({
  icon,
  label,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.link, !last && styles.linkDivider]}>
      <Ionicons name={icon} size={20} color={palette.textMuted} />
      <Text variant="label" weight="medium" style={{ flex: 1 }}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  links: { gap: 0, paddingVertical: 0 },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  linkDivider: { borderBottomWidth: 1, borderBottomColor: '#EEF4F2' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityText: { flex: 1, gap: 4 },
  section: { marginTop: spacing.xxl, gap: spacing.md },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, minHeight: 44, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  roleChipActive: { backgroundColor: palette.primary },
});
