import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { UserRole } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useGrantRole } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useSession } from '@/store/session';
import { palette, spacing } from '@/theme';
import { Button, Card, IconChip, Screen, Spacer, Text } from '@/ui';

const OPTIONS: Array<{ role: UserRole; icon: keyof typeof Ionicons.glyphMap; chip: { bg: string; fg: string } }> = [
  { role: 'CUSTOMER', icon: 'home-outline', chip: palette.chip.teal },
  { role: 'PROVIDER', icon: 'construct-outline', chip: palette.chip.amber },
  { role: 'VENDOR', icon: 'storefront-outline', chip: palette.chip.blue },
  { role: 'CONTRACTOR', icon: 'people-outline', chip: palette.chip.pink },
];

export default function RoleScreen() {
  const t = useStrings();
  const [selected, setSelected] = useState<UserRole>('CUSTOMER');
  const [error, setError] = useState<string | null>(null);
  const grant = useGrantRole();
  const setActiveRole = useSession((s) => s.setActiveRole);

  const submit = async () => {
    setError(null);
    try {
      await grant.mutateAsync(selected as 'CUSTOMER' | 'PROVIDER' | 'VENDOR' | 'CONTRACTOR');
      await setActiveRole(selected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <Screen>
      <Spacer h={spacing.xxl} />
      <Text variant="display">{t('auth.role.title')}</Text>
      <Text variant="body" tone="secondary">
        {t('auth.role.subtitle')}
      </Text>
      <Spacer h={spacing.xxl} />
      <View style={styles.list}>
        {OPTIONS.map((o) => {
          const active = o.role === selected;
          return (
            <Card key={o.role} onPress={() => setSelected(o.role)} accessibilityLabel={t(`role.${o.role}` as never)} style={[styles.option, active && styles.optionActive]}>
              <IconChip icon={o.icon} bg={o.chip.bg} fg={o.chip.fg} size={52} />
              <View style={styles.optionText}>
                <Text variant="subheading">{t(`role.${o.role}` as never)}</Text>
                <Text variant="caption" tone="secondary">
                  {t(`role.${o.role}.body` as never)}
                </Text>
              </View>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? palette.primary : palette.borderStrong} />
            </Card>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" center style={styles.msg}>
          {error}
        </Text>
      ) : null}
      <Spacer h={spacing.xxl} />
      <Button title={t('auth.phone.cta')} fullWidth iconRight="arrow-forward" loading={grant.isPending} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderWidth: 2, borderColor: 'transparent' },
  optionActive: { borderColor: palette.primary },
  optionText: { flex: 1, gap: 2 },
  msg: { marginTop: spacing.md },
});
