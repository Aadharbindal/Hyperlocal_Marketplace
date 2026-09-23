import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { askForNotificationPermission, registerDevice } from '@/api/push';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/api/reach';
import { palette, spacing } from '@/theme';
import { Button, Card, Screen, Skeleton, Spacer, Text } from '@/ui';

/**
 * What we are allowed to send, and where. Deliberately honest in two places: it says which
 * alerts have no switch and why, and it does not pretend a switch works when the phone itself
 * has notifications turned off.
 */
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const [permission, setPermission] = useState<'granted' | 'ask' | 'blocked' | 'unknown'>('unknown');

  useEffect(() => {
    void (async () => {
      const Notifications = await import('expo-notifications');
      const current = await Notifications.getPermissionsAsync();
      setPermission(current.status === 'granted' ? 'granted' : current.canAskAgain ? 'ask' : 'blocked');
    })();
  }, []);

  async function enableOnThisPhone() {
    const granted = await askForNotificationPermission();
    setPermission(granted ? 'granted' : 'blocked');
    if (granted) await registerDevice();
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          Notifications
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {permission !== 'granted' ? (
        <>
          <Card style={styles.callout}>
            <View style={styles.calloutRow}>
              <Ionicons name="notifications-off-outline" size={20} color={palette.primary} />
              <Text variant="label" weight="semibold" style={{ flex: 1 }}>
                {permission === 'blocked' ? 'Notifications are off for this app' : 'Get told when something happens'}
              </Text>
            </View>
            <Text variant="micro" tone="muted">
              {permission === 'blocked'
                ? 'Turn them back on in your phone settings, under this app. The switches below will start working again straight away.'
                : 'We will tell you when an offer arrives, when your professional is on the way, and when money moves. Nothing else.'}
            </Text>
            {permission === 'ask' ? <Button title="Turn on notifications" size="sm" onPress={() => void enableOnThisPhone()} /> : null}
          </Card>
          <Spacer h={spacing.lg} />
        </>
      ) : null}

      {settings.isPending ? (
        <Card style={{ gap: spacing.md }}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="60%" />
        </Card>
      ) : settings.isError ? (
        <Text variant="micro" tone="muted">
          Could not load your settings. Pull down to try again.
        </Text>
      ) : (
        <Card style={styles.group}>
          <Toggle
            label="Booking updates"
            hint="Offers accepted, arrivals, completion - the things happening on a job."
            value={settings.data.jobUpdates}
            onChange={(jobUpdates) => update.mutate({ jobUpdates })}
          />
          <Toggle
            label="New offers"
            hint="When a professional bids on something you posted."
            value={settings.data.offers}
            onChange={(offers) => update.mutate({ offers })}
          />
          <Toggle
            label="Offers and news from us"
            hint="Occasional. Off unless you turn it on."
            value={settings.data.marketing}
            onChange={(marketing) => update.mutate({ marketing })}
            last
          />
        </Card>
      )}

      <Spacer h={spacing.md} />
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={14} color={palette.textMuted} />
        <Text variant="micro" tone="muted" style={{ flex: 1 }}>
          Alerts about your money and your account have no switch. Finding out that a payout failed
          by noticing the money never arrived would be worse than being told.
        </Text>
      </View>

      <Spacer h={spacing.md} />
      <View style={styles.note}>
        <Ionicons name="lock-closed-outline" size={14} color={palette.textMuted} />
        <Text variant="micro" tone="muted" style={{ flex: 1 }}>
          A notification on your lock screen says what happened, never what it was about - no amounts,
          no addresses, no phone numbers.
        </Text>
      </View>
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggle, !last && styles.toggleDivider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight="semibold">
          {label}
        </Text>
        <Text variant="micro" tone="muted">
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.primary, false: '#D9E4E0' }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  callout: { gap: spacing.sm, borderWidth: 1, borderColor: palette.primary },
  calloutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  group: { gap: 0, paddingVertical: 0 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  toggleDivider: { borderBottomWidth: 1, borderBottomColor: '#EEF4F2' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
