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
import type { JobStatus, LatLng } from '@hyperlocal/core';
import { useArrival } from '@/api/arrival';
import { useServiceArea } from '@/api/geo';
import { MapCanvas } from '@/features/geo/MapCanvas';
import { palette, radius, spacing } from '@/theme';
import { Card, Spacer, Text } from '@/ui';

/**
 * "How far away are they?" - on the screen of somebody sitting at home waiting.
 *
 * This card showed a distance and a time and refused to show a map, on the argument that a distance
 * answers the question and a dot is something you can follow. The map is here now, and the argument
 * it replaced was not wrong so much as absolute: the position being drawn was already rounded to
 * ~110 m on the way into the database, so the dot can say which street somebody is on and cannot say
 * which building. For a customer who has taken an afternoon off, seeing the dot move is the
 * difference between trusting the estimate and watching a number they have no reason to believe.
 *
 * The restraint that is left is in what is *not* drawn. There is no map once the signal has gone
 * stale - the server withholds the point for exactly that reason, because an old dot looks precisely
 * as live as a live one. There is no trail, no history, and nothing at all outside EN_ROUTE, so the
 * card cannot become a fixture that implies tracking when none is happening.
 */
export function ArrivalCard({ jobId, status, destination }: { jobId: string; status: JobStatus; destination?: LatLng | null }) {
  const enabled = status === 'EN_ROUTE';
  const arrival = useArrival(jobId, enabled);
  const area = useServiceArea();
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

  // STALE carries no point by design, so this is false exactly when there is nothing honest to draw.
  const live = state.kind === 'ON_THE_WAY' || state.kind === 'ARRIVING_NOW' ? state.point : null;

  return (
    <Animated.View entering={FadeIn.duration(320)}>
      <Card style={styles.wrap}>
      <View style={styles.card}>
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
      </View>

      {live ? (
        <>
          <Spacer h={spacing.md} />
          <MapCanvas
            height={170}
            // Opens on the worker, because that is the thing that moves. The home marker is almost
            // always in frame anyway at the distances this card appears at.
            centre={live}
            spanKm={Math.max(0.6, (state.kind === 'ON_THE_WAY' ? state.distanceKm : 0.3) * 2.4)}
            markers={[
              // `animate` is set only here: the dot glides between the fifteen-second updates
              // instead of teleporting, which is the difference between reading as movement and
              // reading as a glitch.
              { id: 'worker', point: live, kind: 'worker', label: 'The professional on their way', animate: true },
              ...(destination ? [{ id: 'home', point: destination, kind: 'home' as const, label: 'Your address' }] : []),
            ]}
            followPoint={live}
            tilesLive={area.data?.mapsLive ?? true}
          />
          <Spacer h={spacing.xs} />
          <Text variant="micro" tone="muted">
            Shown to about a hundred metres, and only while they are on their way.
          </Text>
        </>
      ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
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
