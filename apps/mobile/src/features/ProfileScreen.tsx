import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Language, UserRole } from '@hyperlocal/core';
import { useLogout, useMe, useUpdateMe } from '@/api/hooks';
import { useWarrantyClaims } from '@/api/warranty';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, spacing } from '@/theme';
import { Badge, Button, Card, ErrorState, Screen, SegmentedControl, Skeleton, Spacer, Text } from '@/ui';

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
  const reduced = useReducedMotion();
  // Only asked for by the roles that can answer a claim.
  const claims = useWarrantyClaims();
  const openClaims = (claims.data ?? []).filter((c) => c.status === 'OPEN').length;

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    updateMe.mutate({ preferredLanguage: l });
  };

  const roles = user?.roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role) ?? [];

  /**
   * "Member since March 2025", in the user's own language.
   *
   * Month and year only. A join date to the day is a precise fact about somebody that serves no
   * purpose on this screen, and the rounded version is the part that actually means something.
   */
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' })
    : null;
  const verification = me.data?.profiles.provider?.verificationStatus ?? me.data?.profiles.vendor?.verificationStatus ?? me.data?.profiles.contractor?.verificationStatus;

  /** Sections arrive in sequence rather than all at once, which reads as arriving rather than appearing. */
  const enter = (index: number) => (reduced ? undefined : FadeInDown.delay(index * 70).duration(400));

  return (
    <Screen withTabBar refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <Text variant="title" weight="bold">
        {t('tabs.profile')}
      </Text>
      <Spacer />

      <Animated.View entering={enter(0)}>
        {/* The whole card opens the editor. A profile you cannot edit by tapping is a profile
            people assume they cannot edit at all. */}
        <Card style={styles.identity} padding="lg" onPress={() => router.push('/edit-profile')} accessibilityLabel={`${user?.displayName ?? ''}. ${t('settings.editProfile')}`}>
          <View style={styles.identityAvatar}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.identityAvatarImage} accessibilityIgnoresInvertColors />
            ) : (
              // A person, not initials. An account that has a name now usually has one, but the
              // placeholder still has to work for the ones that do not.
              <Ionicons name="person-outline" size={34} color={palette.primaryDeep} />
            )}
          </View>
          <View style={styles.identityText}>
            {/* The Indian flag emoji used to sit in front of the name, and two things were wrong
                with it. A regional-indicator pair has no glyph on several platforms and the
                fallback is the two letters it is built from - so a person opened their own profile
                and found "IN Ravi Kumar", which reads as a typo in their name. And where it does
                render it still says nothing: this app runs in one country, so a flag is not
                distinguishing them from anybody. */}
            <Text variant="heading" weight="bold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {user?.displayName ?? user?.phoneMasked ?? ''}
            </Text>
            <Text variant="caption" tone="muted">
              {user?.phoneMasked}
            </Text>
            {memberSince ? (
              <Text variant="micro" tone="muted">
                {`${t('profile.member')} ${memberSince}`}
              </Text>
            ) : null}
            {user?.status === 'SUSPENDED' ? <Badge tone="danger" icon="alert-circle" label={t('error.AUTH_SUSPENDED')} /> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Card>
      </Animated.View>

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
            <Animated.View style={styles.section} entering={enter(1)}>
              <Text variant="subheading" weight="bold">
                {t('profile.verification')}
              </Text>
              <Badge tone={VERIFICATION_TONE[verification] ?? 'neutral'} icon="shield-checkmark" label={verification.replace('_', ' ')} />
            </Animated.View>
          ) : null}

          <Animated.View style={styles.section} entering={enter(2)}>
            <Text variant="subheading" weight="bold">
              {t('profile.roles')}
            </Text>
            {/* Switching role changes what the whole app is, so a screen reader hearing this as a
                radio group rather than a row of buttons is not a nicety. */}
            <SegmentedControl
              label={t('profile.roles')}
              options={roles.map((r) => ({
                value: r,
                label: r.charAt(0) + r.slice(1).toLowerCase(),
                icon: r === activeRole ? 'checkmark-circle' : 'people-outline',
              }))}
              value={activeRole}
              onChange={(r) => void setActiveRole(r as UserRole)}
            />
          </Animated.View>
        </>
      )}

      <Animated.View style={styles.section} entering={enter(3)}>
        <Text variant="subheading" weight="bold">
          {t('profile.language')}
        </Text>
        {/* Each option is written in its own language rather than translated into the current one:
            somebody who has landed in the wrong language needs to recognise their own word for it,
            not read ours. */}
        <SegmentedControl
          label={t('profile.language')}
          options={[
            { value: 'en', label: 'English', icon: 'globe-outline' },
            { value: 'hi', label: 'हिन्दी', icon: 'language-outline' },
          ]}
          value={language}
          onChange={(l) => changeLanguage(l as 'en' | 'hi')}
        />
      </Animated.View>

      {/* Everything else a person owns, in one place. Shown per role, because a vendor has no
          use for a list of saved plumbers. */}
      <Animated.View style={styles.section} entering={enter(4)}>
        <Text variant="subheading" weight="bold">
          {t('settings.account')}
        </Text>
        <Card style={styles.links} padding={0}>
          <Link
            tint="teal"
            icon="person-circle-outline"
            label={t('settings.editProfile')}
            hint={t('settings.editProfile.hint')}
            onPress={() => router.push('/edit-profile')}
          />
          <Link
            tint="mint"
            icon="notifications-outline"
            label={t('settings.notifications')}
            hint={t('settings.notifications.hint')}
            onPress={() => router.push('/notification-settings')}
          />
          {/* A claim carries a 48-hour clock, so it is badged rather than buried. */}
          {activeRole === 'PROVIDER' || activeRole === 'CONTRACTOR' ? (
            <Link
              tint="teal"
              icon="shield-checkmark-outline"
              label={t('settings.warrantyClaims')}
              hint={t('settings.warrantyClaims.hint')}
              badge={openClaims > 0 ? openClaims : undefined}
              onPress={() => router.push('/warranty-claims')}
            />
          ) : null}
          {activeRole === 'CUSTOMER' ? (
            <>
              {/* First in the list on purpose. Without an address a booking cannot be completed
                  at all, and the booking form sends people here to fix exactly that. */}
              <Link
                tint="blue"
                icon="location-outline"
                label={t('settings.addresses')}
                hint={t('settings.addresses.hint')}
                onPress={() => router.push('/addresses')}
              />
              {/* High in the customer list on purpose: a standing arrangement is easy to forget
                  you have, and the whole feature depends on it staying visible. */}
              <Link
                tint="teal"
                icon="repeat"
                label={t('settings.plans')}
                hint={t('settings.plans.hint')}
                onPress={() => router.push('/service-plans')}
              />
              <Link
                tint="amber"
                icon="receipt-outline"
                label={t('settings.receipts')}
                hint={t('settings.receipts.hint')}
                onPress={() => router.push('/receipts')}
              />
              <Link
                tint="rose"
                icon="heart-outline"
                label={t('settings.saved')}
                hint={t('settings.saved.hint')}
                onPress={() => router.push('/favourites')}
              />
              {/* Customers only, because this is about a stranger being in *your* home - the
                  provider is the stranger, and offering them the same row would read as a
                  suggestion that the customer is the danger. */}
              <Link
                tint="rose"
                icon="shield-outline"
                label={t('settings.emergency')}
                hint={t('settings.emergency.hint')}
                onPress={() => router.push('/emergency-contacts')}
              />
            </>
          ) : null}
          <Link
            tint="violet"
            icon="gift-outline"
            label={t('settings.invite')}
            hint={t('settings.invite.hint')}
            onPress={() => router.push('/referrals')}
            last
          />
        </Card>
      </Animated.View>

      {/* A second group, below the things somebody uses, for the things they only need once. */}
      <Animated.View style={styles.section} entering={enter(5)}>
        <Card style={styles.links} padding={0}>
          <Link
            tint="blue"
            icon="help-circle-outline"
            label={t('settings.help')}
            hint={t('settings.help.hint')}
            onPress={() => router.push('/help')}
          />
          <Link
            tint="rose"
            icon="trash-outline"
            label={t('settings.deleteAccount')}
            hint={t('settings.deleteAccount.hint')}
            onPress={() => router.push('/delete-account')}
            last
          />
        </Card>
      </Animated.View>

      <Spacer h={spacing.xxl} />
      <Animated.View entering={enter(6)}>
        <Button title={t('profile.signOut')} variant="danger" size="md" fullWidth icon="log-out-outline" loading={logout.isPending} onPress={() => logout.mutate()} />
      </Animated.View>
    </Screen>
  );
}

function Link({
  icon,
  tint,
  label,
  hint,
  onPress,
  last,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: keyof typeof palette.chip;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
  badge?: number;
}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  /**
   * A row that gives a little under the finger.
   *
   * A list of chevrons with no feedback reads as a picture of a menu. The scale is small on
   * purpose - enough to feel the tap land, not enough to be a effect somebody notices twice.
   */
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 - pressed.value * 0.02 }],
    // Compared against a threshold, not truthiness. A spring settles *towards* zero and passes
    // through a long tail of tiny non-zero values, every one of which is truthy - so rows kept
    // their pressed tint after the finger had gone. Timing lands on exactly zero, and the
    // threshold means it would not matter if it did not.
    backgroundColor: pressed.value > 0.05 ? '#F7FBF9' : 'transparent',
  }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressed.value = reduced ? 1 : withTiming(1, { duration: 90 });
        }}
        onPressOut={() => {
          pressed.value = reduced ? 0 : withTiming(0, { duration: 160 });
        }}
        accessibilityRole="button"
        accessible
        // One sentence, because a screen reader reading the title, then the hint, then "button"
        // as three separate stops is a worse version of the same information.
        accessibilityLabel={badge ? `${label}. ${hint}. ${badge} waiting` : `${label}. ${hint}`}
        style={[styles.link, !last && styles.linkDivider]}
      >
        <View style={styles.linkInner} importantForAccessibility="no-hide-descendants">
          <View style={[styles.linkIcon, { backgroundColor: palette.chip[tint].bg }]}>
            <Ionicons name={icon} size={19} color={palette.chip[tint].fg} />
          </View>
          <View style={styles.linkText}>
            <Text variant="label" weight="semibold">
              {label}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {hint}
            </Text>
          </View>
          {badge ? (
            <View style={styles.linkBadge}>
              <Text variant="micro" weight="bold" style={{ color: palette.textOnPrimary }}>
                {badge}
              </Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  links: { gap: 0, overflow: 'hidden' },
  link: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  linkInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkDivider: { borderBottomWidth: 1, borderBottomColor: palette.surfaceMuted },
  linkIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, gap: 1 },
  linkBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primary },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  identityAvatarImage: { width: '100%', height: '100%' },
  identityText: { flex: 1, gap: 2 },
  section: { marginTop: spacing.xxl, gap: spacing.md },
});
