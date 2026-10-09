import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { formatInr, type AcceptOfferResponse, type OfferView, type PromoPreview } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useAcceptOffer, useCompleteMockPayment } from '@/api/negotiation';
import { usePromoPreview } from '@/api/growth';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, DataRow, Text, TextField } from '@/ui';

type Stage = 'review' | 'paying' | 'done';

/**
 * Accept -> authorize. The customer sees the exact frozen price before anything is charged,
 * and the booking is only confirmed once the gateway authorizes (PAYMENT_FLOW.md).
 */
export function ConfirmSheet({ jobId, offer, onClose }: { jobId: string; offer: OfferView | null; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('review');
  const [accepted, setAccepted] = useState<AcceptOfferResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accept = useAcceptOffer();
  const pay = useCompleteMockPayment();

  /**
   * A promo code, which had nowhere to be typed.
   *
   * The whole pipeline existed: staff can create codes in the console, `/promo/preview` prices one
   * against an order, and `/bids/:id/accept` takes a `promoCode`, re-checks it and returns the
   * discount it applied. The only missing piece was a box - so every code anybody created was
   * unredeemable.
   *
   * Previewing is deliberately separate from applying. What the preview says is not trusted for a
   * moment: the server prices it again at acceptance, which is the only number that can be charged.
   */
  const preview = usePromoPreview();
  const [promoOpen, setPromoOpen] = useState(false);
  const [code, setCode] = useState('');
  const [promo, setPromo] = useState<PromoPreview | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  async function checkCode() {
    setPromoError(null);
    setPromo(null);
    if (!offer) return;
    try {
      const res = await preview.mutateAsync({ code: code.trim().toUpperCase(), orderPaise: offer.totalPaise });
      setPromo(res.promo);
    } catch (e) {
      setPromoError(e instanceof ApiError ? e.message : 'That code did not work.');
    }
  }

  function close() {
    setStage('review');
    setAccepted(null);
    setError(null);
    setPromoOpen(false);
    setCode('');
    setPromo(null);
    setPromoError(null);
    onClose();
  }

  async function onAccept() {
    if (!offer) return;
    setError(null);
    try {
      const res = await accept.mutateAsync({
        jobId,
        bidId: offer.id,
        ...(promo ? { promoCode: promo.code } : {}),
      });
      setAccepted(res);
      setStage('paying');
    } catch (e) {
      setError(e instanceof ApiError ? acceptError(e) : 'Something went wrong. Please try again.');
    }
  }

  async function onPay() {
    if (!accepted) return;
    setError(null);
    try {
      await pay.mutateAsync({ jobId, paymentId: accepted.payment.id, outcome: 'authorized' });
      setStage('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment could not be completed.');
    }
  }

  const q = accepted?.quote;

  return (
    <Modal visible={!!offer} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={stage === 'paying' ? undefined : close} accessibilityLabel="Close" />
      <Animated.View entering={FadeInDown.duration(280)} style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView showsVerticalScrollIndicator={false}>
          {stage === 'done' ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.done}>
              <View style={styles.doneBadge}>
                <Ionicons name="checkmark" size={34} color={palette.textOnPrimary} />
              </View>
              <Text weight="extrabold" style={styles.doneTitle}>
                Booking confirmed
              </Text>
              <Text variant="caption" tone="secondary" center>
                {q?.providerBusinessName ?? 'Your provider'} is confirmed. You will get a 4-digit start code to share when they arrive.
              </Text>
              <Button title="Done" fullWidth style={styles.cta} onPress={close} />
            </Animated.View>
          ) : (
            <>
              <Text weight="bold" style={styles.title}>
                {stage === 'review' ? 'Confirm this offer' : 'Authorize payment'}
              </Text>
              <Text variant="caption" tone="secondary">
                {stage === 'review'
                  ? 'This price is locked once you confirm. Extra work always needs your approval.'
                  : 'Nothing is charged until the work is approved by you.'}
              </Text>

              <View style={styles.providerRow}>
                <View style={styles.avatar}>
                  <Text weight="bold" tone="primary">
                    {(q?.providerBusinessName ?? offer?.provider.businessName ?? '?').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.providerText}>
                  <Text variant="label" weight="semibold" numberOfLines={1}>
                    {q?.providerBusinessName ?? offer?.provider.businessName}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {offer ? `${offer.provider.completedJobs} jobs · ${offer.provider.distanceKm} km away` : ''}
                  </Text>
                </View>
                {offer?.provider.verified && <Badge tone="success" icon="shield-checkmark" label="Verified" />}
              </View>

              <View style={styles.breakdown}>
                <DataRow label="Labour" value={formatInr(q?.labourPaise ?? offer?.labourPaise ?? 0)} />
                {(q?.visitFeePaise ?? offer?.visitFeePaise ?? 0) > 0 && (
                  <DataRow label="Visit fee" value={formatInr(q?.visitFeePaise ?? offer?.visitFeePaise ?? 0)} />
                )}
                <DataRow label="Platform fee" value={formatInr(q?.platformFeePaise ?? offer?.platformFeePaise ?? 0)} tone="muted" />
                <DataRow label="Tax on fee" value={formatInr(q?.taxPaise ?? offer?.taxPaise ?? 0)} tone="muted" />
                {/* The discount the *server* applied once accepted, or the previewed one before
                    that. They are the same number in every ordinary case; if they ever differ the
                    accepted quote is the one that is true, so it wins here. */}
                {accepted?.promoCode ? (
                  <DataRow
                    label={`Discount (${accepted.promoCode})`}
                    value={`- ${formatInr(accepted.discountPaise ?? 0)}`}
                    tone="success"
                  />
                ) : promo && stage === 'review' ? (
                  <DataRow label={`Discount (${promo.code})`} value={`- ${formatInr(promo.discountPaise)}`} tone="success" />
                ) : null}
                {/* After acceptance this is what the gateway is actually asked for, which is the
                    quote minus the discount - the quote itself stays whole, because a discount is
                    the platform's cost and the professional is paid what the quote said. Showing
                    the quote total here beside a discount row would not add up on the page. */}
                <DataRow
                  label="Total"
                  value={formatInr(
                    accepted?.payment.amountPaise ??
                      (promo && stage === 'review' ? promo.newTotalPaise : offer?.totalPaise ?? 0),
                  )}
                  total
                />
              </View>

              {/* Only before acceptance. Once the quote is frozen the price is the price, and a
                  code box that silently does nothing would be worse than no box. */}
              {stage === 'review' ? (
                promoOpen ? (
                  <View style={styles.promo}>
                    <TextField
                      label="Promo code"
                      value={code}
                      onChangeText={(v) => {
                        setCode(v.toUpperCase());
                        setPromo(null);
                        setPromoError(null);
                      }}
                      placeholder="SAVE100"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={24}
                      error={promoError}
                      helper={promo ? promo.description : undefined}
                    />
                    <View style={styles.promoActions}>
                      <Button title="Remove" size="sm" variant="ghost" onPress={() => { setPromoOpen(false); setCode(''); setPromo(null); setPromoError(null); }} />
                      <Button
                        title={promo ? 'Applied' : 'Check'}
                        size="sm"
                        icon={promo ? 'checkmark' : undefined}
                        loading={preview.isPending}
                        disabled={code.trim().length < 3 || !!promo}
                        onPress={() => void checkCode()}
                      />
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setPromoOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Add a promo code"
                    style={styles.promoLink}
                  >
                    <Ionicons name="pricetag-outline" size={15} color={palette.primaryDeep} />
                    <Text variant="caption" weight="semibold" tone="primary">
                      Have a promo code?
                    </Text>
                  </Pressable>
                )
              ) : null}

              <View style={styles.tags}>
                <Badge tone="neutral" icon="time-outline" label={`${Math.round((q?.etaMinutes ?? offer?.etaMinutes ?? 0) / 60) || 1} h arrival`} />
                {(q?.warrantyDays ?? offer?.warrantyDays ?? 0) > 0 && (
                  <Badge tone="success" icon="shield-outline" label={`${q?.warrantyDays ?? offer?.warrantyDays} day warranty`} />
                )}
              </View>

              <View style={styles.assurance}>
                <Ionicons name="lock-closed" size={13} color={palette.textMuted} />
                <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                  Materials, if any, are quoted separately and always need your approval.
                </Text>
              </View>

              {error && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={16} color={palette.danger} />
                  <Text variant="caption" style={{ color: palette.danger, flex: 1 }}>
                    {error}
                  </Text>
                </Animated.View>
              )}

              {stage === 'review' ? (
                <Button title="Confirm and continue" fullWidth iconRight="arrow-forward" loading={accept.isPending} style={styles.cta} onPress={onAccept} />
              ) : (
                <Button
                  title={`Authorize ${formatInr(accepted?.payment.amountPaise ?? 0)}`}
                  fullWidth
                  icon="lock-closed"
                  loading={pay.isPending}
                  style={styles.cta}
                  onPress={onPay}
                />
              )}
              <Pressable onPress={close} accessibilityRole="button" style={styles.cancel}>
                <Text variant="caption" weight="semibold" tone="muted">
                  {stage === 'review' ? 'Not now' : 'Pay later'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}


function acceptError(e: ApiError): string {
  const first = (e.details as { acceptance?: string[] } | undefined)?.acceptance?.[0];
  switch (first) {
    case 'BID_NOT_ACTIVE':
      return 'This provider has withdrawn their offer.';
    case 'BID_EXPIRED':
      return 'This offer has expired. Ask the provider to send it again.';
    case 'ALREADY_CONFIRMED':
    case 'JOB_NOT_ACCEPTABLE':
      return 'This booking is already confirmed with another provider.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  promo: { gap: spacing.md, marginTop: spacing.md },
  promoActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  promoLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: spacing.xs },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border, marginBottom: spacing.md },
  title: { fontSize: 19, lineHeight: 26, color: palette.text },

  providerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  providerText: { flex: 1, gap: 2 },

  breakdown: { marginTop: spacing.lg, backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cta: { marginTop: spacing.xl },
  cancel: { alignItems: 'center', marginTop: spacing.md, minHeight: 40, justifyContent: 'center' },

  done: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  doneBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 22, lineHeight: 28, color: palette.text },
});
