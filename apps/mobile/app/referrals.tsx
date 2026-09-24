import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { formatInr } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useClaimReferral, useReferrals } from '@/api/growth';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Card, Screen, Skeleton, Spacer, Text, TextField } from '@/ui';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  PENDING: { label: 'waiting on their first booking', tone: 'warning' },
  QUALIFIED: { label: 'reward on its way', tone: 'success' },
  REWARDED: { label: 'paid', tone: 'success' },
  REJECTED: { label: 'not eligible', tone: 'neutral' },
};

const CLAIM_ERROR: Record<string, string> = {
  SELF_REFERRAL: 'That is your own code.',
  ALREADY_REFERRED: 'You have already used a code.',
  NOT_A_NEW_USER: 'Codes are for a first booking. You have already booked with us.',
  CODE_NOT_FOUND: 'We do not recognise that code.',
};

/**
 * Inviting people, and claiming somebody else's invite.
 *
 * The terms are stated at the top rather than buried: a reward arrives when the friend
 * **completes** their first booking, not when they sign up. Saying so plainly is the difference
 * between a referral programme and one people feel misled by.
 */
export default function ReferralsScreen() {
  const router = useRouter();
  const referrals = useReferrals();
  const claim = useClaimReferral();
  const [code, setCode] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!referrals.data) return;
    await Clipboard.setStringAsync(referrals.data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!referrals.data) return;
    await Share.share({
      message: `Use my code ${referrals.data.code} when you book your first job, and we both get ${formatInr(referrals.data.rewardPaise)}.`,
    });
  }

  async function onClaim() {
    setClaimError(null);
    try {
      const r = await claim.mutateAsync(code.trim().toUpperCase());
      setClaimed(r.referrerName);
      setCode('');
    } catch (e) {
      const which = e instanceof ApiError ? (e.details as { growth?: string[] } | undefined)?.growth?.[0] : undefined;
      setClaimError((which && CLAIM_ERROR[which]) ?? 'We could not use that code.');
    }
  }

  return (
    <Screen refreshing={referrals.isRefetching} onRefresh={() => void referrals.refetch()}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text variant="title" weight="bold">
          Invite a friend
        </Text>
      </View>
      <Spacer h={spacing.lg} />

      {referrals.isPending ? (
        <Card style={{ gap: spacing.md }}>
          <Skeleton height={28} width="50%" />
          <Skeleton height={80} />
        </Card>
      ) : referrals.isError ? (
        <Text variant="caption" tone="muted">
          Could not load your code. Pull down to try again.
        </Text>
      ) : (
        <>
          <Card style={styles.hero}>
            <Text variant="caption" tone="secondary">
              Your code
            </Text>
            <Pressable onPress={() => void copy()} accessibilityRole="button" accessibilityLabel={`Copy code ${referrals.data.code}`}>
              <View style={styles.codeRow}>
                <Text weight="extrabold" style={styles.code}>
                  {referrals.data.code}
                </Text>
                <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={20} color={copied ? palette.primary : palette.textMuted} />
              </View>
            </Pressable>
            {/* Stated plainly, not buried: the reward comes on a completed booking. */}
            <Text variant="micro" tone="muted">
              {referrals.data.terms}
            </Text>
            <Spacer h={spacing.xs} />
            <Button title="Share your code" icon="share-social-outline" fullWidth onPress={() => void share()} />
          </Card>

          <Spacer h={spacing.md} />
          <View style={styles.stats}>
            <Stat label="Invited" value={String(referrals.data.invited)} />
            <Stat label="Qualified" value={String(referrals.data.qualified)} />
            <Stat label="Earned" value={formatInr(referrals.data.earnedPaise)} />
          </View>

          {referrals.data.people.length > 0 ? (
            <>
              <Text weight="semibold" style={styles.section}>
                People you invited
              </Text>
              <View style={styles.list}>
                {referrals.data.people.map((person, i) => {
                  const meta = STATUS[person.status] ?? { label: person.status.toLowerCase(), tone: 'neutral' as const };
                  return (
                    <Card key={`${person.name}-${i}`} style={styles.row}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label" weight="semibold">
                          {person.name}
                        </Text>
                        <Text variant="micro" tone="muted">
                          Joined {new Date(person.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                      <Badge tone={meta.tone} label={meta.label} />
                    </Card>
                  );
                })}
              </View>
            </>
          ) : null}

          {/* Claiming somebody else's code. Only shown while it can still be used. */}
          {referrals.data.invited === 0 ? (
            <>
              <Text weight="semibold" style={styles.section}>
                Have a code?
              </Text>
              {claimed ? (
                <Card style={styles.claimed}>
                  <Ionicons name="checkmark-circle" size={20} color={palette.primary} />
                  <Text variant="caption" style={{ flex: 1 }}>
                    Added. You and {claimed} both get a reward once your first booking is done.
                  </Text>
                </Card>
              ) : (
                <Card style={{ gap: spacing.sm }}>
                  <TextField
                    label="Friend's code"
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    placeholder="ABC123"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    icon="gift-outline"
                    error={claimError}
                  />
                  <Button title="Use this code" size="sm" loading={claim.isPending} disabled={code.trim().length < 4} onPress={() => void onClaim()} />
                </Card>
              )}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="label" weight="bold">
        {value}
      </Text>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hero: { gap: spacing.xs },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  code: { fontSize: 34, lineHeight: 42, letterSpacing: 6, color: palette.text },
  stats: { flexDirection: 'row', gap: spacing.md, backgroundColor: '#F6FBF9', borderRadius: radius.md, padding: spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  section: { fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  claimed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
