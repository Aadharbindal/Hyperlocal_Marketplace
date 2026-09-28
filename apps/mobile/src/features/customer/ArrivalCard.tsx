import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { JobStatus } from '@hyperlocal/core';
import { useArrival } from '@/api/arrival';
import { palette, radius, spacing } from '@/theme';
import { Card, Text } from '@/ui';

/**
 * "How far away are they?" - on the screen of somebody sitting at home waiting.
 *
 * The card shows a distance and a time and never a map. That is not a shortcut: a point on a map
 * is something you can follow, a distance is an answer to the question actually being asked, and
 * the person being located is a worker rather than a parcel. It also means a screenshot of this
 * screen gives away nothing about where anybody is.
 *
 * It renders nothing at all unless the job is on the way, so it cannot become a permanent
 * fixture that quietly implies tracking outside that window.
 */
export function ArrivalCard({ jobId, status }: { jobId: string; status: JobStatus }) {
  const enabled = status === 'EN_ROUTE';
  const arrival = useArrival(jobId, enabled);
  const reduced = useReducedMotion();

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!enabled || reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [enabled, reduced, pulse]);

  const dot = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.65,
    transform: [{ scale: 0.9 + pulse.value * 0.25 }],
  }));

  if (!enabled) return null;

  const state = arrival.data;
  // Nothing is shown until there is something true to say. An empty card that appears the moment
  // somebody sets off and then says "—" for two minutes reads as broken.
  if (!state || state.kind === 'NOT_TRACKING') return null;

  return (
    <Animated.View entering={FadeIn.duration(320)}>
      <Card style={styles.card}>
        <View style={styles.iconWrap}>
          {state.kind !== 'STALE' && <Animated.View style={[styles.pulse, dot]} />}
          <Ionicons
            name={state.kind === 'ARRIVING_NOW' ? 'home' : state.kind === 'STALE' ? 'cloud-offline-outline' : 'navigate'}
            size={20}
            color={palette.primaryDeep}
          />
        </View>

        <View style={styles.text}>
          {state.kind === 'ARRIVING_NOW' ? (
            <>
              <Text variant="label" weight="bold">
                Arriving now
              </Text>
              <Text variant="micro" tone="muted">
                They are just outside.
              </Text>
            </>
          ) : state.kind === 'STALE' ? (
            <>
              {/* Honest rather than reassuring. A stale position shown as live is worse than
                  none, because the customer plans around it. */}
              <Text variant="label" weight="bold">
                Still on the way
              </Text>
              <Text variant="micro" tone="muted">
                We have lost their signal for a moment - this is normal in lifts and basements.
              </Text>
            </>
          ) : (
            <>
              <Text variant="label" weight="bold">
                {state.etaMinutes === 1 ? 'About a minute away' : `About ${state.etaMinutes} minutes away`}
              </Text>
              <Text variant="micro" tone="muted">
                {`${state.distanceKm.toFixed(1)} km from your address`}
              </Text>
            </>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.primarySoft,
    borderWidth: 2,
    borderColor: palette.primary,
  },
  text: { flex: 1, gap: 2 },
  spacer: { height: radius.sm },
});
