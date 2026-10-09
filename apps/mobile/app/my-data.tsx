import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import type { DataExportView, ExportSection } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useDataExport } from '@/api/warranty';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, DataRow, Screen, Spacer, Text } from '@/ui';

/**
 * The right of access, which the app had no way to exercise.
 *
 * `GET /me/export` has existed since the trust work, tested, with nothing calling it - while
 * *deletion* has had a screen since M1. A product that offers the destructive half of somebody's
 * rights and not the other half has made a choice, whether or not anybody meant to: the DPDP Act
 * 2023 does not treat access as optional, and a Play Store review does not either.
 *
 * The screen is deliberately about what is *in* the file rather than about the file. Handing
 * somebody a blob of JSON and calling it transparency is the form of compliance that tells them
 * nothing; the counts and the exclusions are the part a person can actually read.
 */
export default function MyDataScreen() {
  const router = useRouter();
  const exportData = useDataExport();
  const reduced = useReducedMotion();
  const [result, setResult] = useState<DataExportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setError(null);
    setCopied(false);
    try {
      setResult(await exportData.mutateAsync());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We could not build your file. Please try again.');
    }
  }

  async function copy() {
    if (!result) return;
    await Clipboard.setStringAsync(JSON.stringify(result.data, null, 2));
    setCopied(true);
  }

  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold" style={styles.flex}>
          Download my data
        </Text>
      </View>
      <Spacer h={spacing.md} />
      <Text variant="caption" tone="secondary">
        Everything we hold about you, gathered in one place. It is built when you ask and is not
        stored anywhere afterwards.
      </Text>
      <Spacer h={spacing.xl} />

      {!result ? (
        <>
          <Card style={styles.intro}>
            <View style={styles.introIcon}>
              <Ionicons name="shield-checkmark-outline" size={22} color={palette.primaryDeep} />
            </View>
            <Text variant="label" weight="semibold">
              What you will get
            </Text>
            <Text variant="caption" tone="secondary">
              Your account and the bookings you have made, the addresses you saved, your payments
              and receipts, the reviews you wrote, your warranty claims, your notifications and the
              messages you exchanged with professionals.
            </Text>
            <Text variant="micro" tone="muted">
              Anything left out is named in the result, with the reason - so a gap is never
              something you have to notice for yourself.
            </Text>
          </Card>
          {error ? (
            <>
              <Spacer h={spacing.md} />
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            </>
          ) : null}
          <Spacer h={spacing.xl} />
          <Button
            title="Build my file"
            fullWidth
            icon="download-outline"
            loading={exportData.isPending}
            onPress={() => void run()}
          />
        </>
      ) : (
        <Animated.View entering={reduced ? undefined : FadeInDown.duration(320)}>
          <Card style={styles.result}>
            <View style={styles.resultHead}>
              <Ionicons name="checkmark-circle" size={20} color={palette.success} />
              <Text variant="label" weight="bold" style={styles.flex}>
                {total === 1 ? '1 record' : `${total} records`}
              </Text>
              <Badge tone="neutral" label={new Date(result.generatedAt).toLocaleDateString('en-IN')} />
            </View>

            {/* The counts, not the JSON. "Your 14 bookings are in here" is the sentence somebody
                can check against what they remember; a blob of braces is not. */}
            <View style={styles.counts}>
              {Object.entries(result.counts)
                .filter(([, n]) => n > 0)
                .map(([section, n]) => (
                  <DataRow key={section} label={sectionLabel(section)} value={String(n)} />
                ))}
              {total === 0 ? (
                <Text variant="caption" tone="muted">
                  There is nothing here yet, which for a new account is the right answer.
                </Text>
              ) : null}
            </View>
          </Card>

          {result.exclusions.length > 0 ? (
            <>
              <Spacer h={spacing.lg} />
              <Text variant="label" weight="semibold">
                What is not in it
              </Text>
              <Spacer h={spacing.sm} />
              <Card style={styles.exclusions}>
                {result.exclusions.map((x) => (
                  <View key={x.what} style={styles.exclusion}>
                    <Ionicons name="remove-circle-outline" size={15} color={palette.textMuted} />
                    <View style={styles.flex}>
                      <Text variant="caption" weight="semibold">
                        {x.what}
                      </Text>
                      <Text variant="micro" tone="muted">
                        {x.why}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <Spacer h={spacing.xl} />
          {/* Copying rather than saving a file. Writing to storage needs a permission and a
              document picker on each platform, and this is honest about being the smaller thing:
              it puts the data where the person can paste it somewhere they control. */}
          <Button
            title={copied ? 'Copied' : 'Copy everything'}
            fullWidth
            variant="secondary"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={() => void copy()}
          />
          <Spacer h={spacing.sm} />
          <Button title="Build it again" variant="ghost" fullWidth onPress={() => void run()} loading={exportData.isPending} />
        </Animated.View>
      )}

      <Spacer h={spacing.xl} />
      <Text variant="micro" tone="muted">
        Asking for this does not change or delete anything. Deleting your account is a separate
        choice, on the previous screen.
      </Text>
      <Spacer h={spacing.xxl} />
    </Screen>
  );
}

/**
 * The server's section keys, as a person would name them.
 *
 * Typed as a complete `Record<ExportSection, string>` rather than a lookup with a fallback, and
 * that is the whole point: the first version of this was guessed rather than read, so `profile`,
 * `bookings`, `disputes` and `warrantyClaims` fell through and the screen showed somebody the raw
 * key "profile" next to a number. Three of the labels it did define named sections that do not
 * exist. With this shape, adding a section to `EXPORT_SECTIONS` without naming it here stops
 * compiling instead of leaking a field name into a privacy screen.
 */
const SECTION_LABEL: Record<ExportSection, string> = {
  profile: 'Your account',
  addresses: 'Saved addresses',
  consents: 'Consents you gave',
  jobs: 'Bookings',
  bookings: 'Confirmed bookings',
  payments: 'Payments',
  invoices: 'Receipts',
  reviews: 'Reviews you wrote',
  disputes: 'Problems you reported',
  warrantyClaims: 'Warranty claims',
  messages: 'Messages',
  notifications: 'Notifications',
};

function sectionLabel(key: string): string {
  return SECTION_LABEL[key as ExportSection] ?? key;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  intro: { gap: spacing.sm },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  result: { gap: spacing.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  counts: { gap: spacing.sm },
  exclusions: { gap: spacing.md },
  exclusion: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
