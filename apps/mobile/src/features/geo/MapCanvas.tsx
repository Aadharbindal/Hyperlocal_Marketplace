import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LatLng } from '@hyperlocal/core';
import { palette, radius, spacing } from '@/theme';
import { Text } from '@/ui';

/**
 * The only file in the app that imports `react-native-maps`.
 *
 * Everything to do with the map being absent lives here, and there are three separate ways it can
 * be: the native module may not be in the binary at all, the platform may be web where it does not
 * exist, and the Android build may have no Google key, in which case the module loads perfectly and
 * draws a blank grey rectangle. The third is the dangerous one, because it looks like a bug in our
 * app rather than a missing credential, and a blank grey rectangle is also exactly what a broken
 * map looks like - so it gets a notice saying which it is.
 *
 * No screen is allowed to break because of any of the three. Every caller gets a box of the height
 * it asked for, containing either a map or a sentence explaining itself.
 */

type MapsModule = typeof import('react-native-maps');
let cachedMaps: MapsModule | null | undefined;
function loadMaps(): MapsModule | null {
  if (cachedMaps !== undefined) return cachedMaps;
  // react-native-maps has no web implementation, and requiring it there throws on import.
  if (Platform.OS === 'web') return (cachedMaps = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMaps = require('react-native-maps') as MapsModule;
  } catch {
    cachedMaps = null;
  }
  return cachedMaps;
}

export function mapsAvailable(): boolean {
  return loadMaps() !== null;
}

export type MarkerKind = 'home' | 'worker' | 'pin';

export interface MapMarkerSpec {
  id: string;
  point: LatLng;
  kind: MarkerKind;
  /** Read out by a screen reader in place of the icon, which conveys nothing on its own. */
  label: string;
  /**
   * Glide to each new position instead of jumping to it.
   *
   * Only the worker marker sets this. Positions arrive every fifteen seconds, and a dot that
   * teleports four times a minute reads as a glitch, where the same dot sliding reads as movement -
   * which is what it is. The interpolation invents no information: it only spreads the step that
   * already happened across a second of screen time, and it always ends on the real reading.
   */
  animate?: boolean;
}

export interface MapCanvasHandle {
  /** Move the camera without a re-render, for "use my location" and for following a worker. */
  moveTo(point: LatLng, opts?: { zoomKm?: number }): void;
}

interface Props {
  height: number;
  centre: LatLng;
  /** Initial span, as the width of the visible area in kilometres. */
  spanKm?: number;
  markers?: MapMarkerSpec[];
  /** Draws the pilot area. Omitted on screens where the circle is noise rather than information. */
  serviceArea?: { centre: LatLng; radiusKm: number } | null;
  /**
   * False for the read-only maps - a job's location, a worker on the way.
   *
   * A map that pans under a finger inside a scrolling screen steals the scroll, and on those
   * screens there is nothing to pan to anyway.
   */
  interactive?: boolean;
  /** Fired when the user stops moving an interactive map. The picker resolves the centre on this. */
  onRegionSettle?: (point: LatLng) => void;
  /**
   * Keeps the camera on a moving point.
   *
   * Needed because `initialRegion` is set once on mount, deliberately - a `centre` prop that moved
   * the camera would yank the map out from under a finger on the picker. On the arrival card there is
   * no finger and the subject walks out of frame within a kilometre, so that screen opts in.
   */
  followPoint?: LatLng | null;
  /** False when the server says the maps adapter is mocked, so the notice can say which problem. */
  tilesLive?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Degrees of latitude per kilometre - near enough anywhere, and latitude does not foreshorten. */
const DEG_PER_KM = 1 / 110.574;

function deltaFor(spanKm: number) {
  return { latitudeDelta: spanKm * DEG_PER_KM, longitudeDelta: spanKm * DEG_PER_KM };
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { height, centre, spanKm = 1.6, markers = [], serviceArea = null, interactive = false, onRegionSettle, followPoint = null, tilesLive = true, style },
  ref,
) {
  const Maps = loadMaps();
  const mapRef = useRef<InstanceType<MapsModule['default']> | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      moveTo(point, opts) {
        mapRef.current?.animateToRegion(
          { latitude: point.lat, longitude: point.lng, ...deltaFor(opts?.zoomKm ?? 0.8) },
          450,
        );
      },
    }),
    [],
  );

  // The span is held at its mount value so following does not re-zoom on every step.
  const span = useRef(spanKm);
  useEffect(() => {
    if (!followPoint) return;
    mapRef.current?.animateToRegion(
      { latitude: followPoint.lat, longitude: followPoint.lng, ...deltaFor(span.current) },
      900,
    );
  }, [followPoint?.lat, followPoint?.lng]);

  const initial = useMemo(
    () => ({ latitude: centre.lat, longitude: centre.lng, ...deltaFor(spanKm) }),
    // Intentionally only on mount. A changing `centre` prop must not yank the camera out from
    // under somebody's finger; callers that want to move it use the handle.
    [],
  );

  if (!Maps) {
    return (
      <Unavailable
        height={height}
        style={style}
        title="Map not available on this device"
        body={
          Platform.OS === 'web'
            ? 'Maps work in the phone app. You can still type the address by hand.'
            : 'This build does not include the map component. You can still type the address by hand.'
        }
      />
    );
  }

  const { default: RNMap, Marker, Circle } = Maps;

  return (
    <View style={[styles.frame, { height }, style]}>
      <RNMap
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initial}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        // Our own, so it can sit where the sheet is not covering it.
        showsMyLocationButton={false}
        // False deliberately: the blue dot needs the location permission, and this component is
        // rendered on screens that have no business asking for it. The picker asks when its own
        // button is pressed.
        showsUserLocation={false}
        toolbarEnabled={false}
        onRegionChangeComplete={
          interactive && onRegionSettle
            ? (r: { latitude: number; longitude: number }) => onRegionSettle({ lat: r.latitude, lng: r.longitude })
            : undefined
        }
      >
        {serviceArea ? (
          <Circle
            center={{ latitude: serviceArea.centre.lat, longitude: serviceArea.centre.lng }}
            radius={serviceArea.radiusKm * 1000}
            strokeColor={palette.primary}
            strokeWidth={2}
            fillColor={palette.primaryGlow}
          />
        ) : null}
        {markers.map((m) => (
          <AnimatedMarker key={m.id} Marker={Marker} spec={m} />
        ))}
      </RNMap>

      {/* Sits on top of the map rather than replacing it, because the map's own gestures and the
          pin still work - it is only the imagery that is missing. */}
      {!tilesLive ? (
        <View style={styles.notice} pointerEvents="none" accessibilityLiveRegion="polite">
          <Ionicons name="information-circle" size={15} color={palette.warning} />
          <Text variant="micro" style={styles.noticeText}>
            Map imagery is not connected yet, so this area may look blank. Dragging the pin still
            records the exact spot.
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * One marker, with the glide.
 *
 * The tween is plain state on a timer rather than Reanimated: the marker's `coordinate` is a prop
 * read by native code on every frame of its own layout pass, not a style, so there is nothing for
 * the UI thread to interpolate and a worklet would have to cross back anyway. Twenty frames over
 * 900 ms is imperceptibly short of smooth and costs nothing measurable.
 */
function AnimatedMarker({ Marker, spec }: { Marker: MapsModule['Marker']; spec: MapMarkerSpec }) {
  const [shown, setShown] = useState(spec.point);
  const from = useRef(spec.point);

  useEffect(() => {
    if (!spec.animate) {
      setShown(spec.point);
      return;
    }
    const start = from.current;
    const target = spec.point;
    if (start.lat === target.lat && start.lng === target.lng) return;
    const STEPS = 20;
    const MS = 900;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      const t = i / STEPS;
      if (t >= 1) {
        clearInterval(timer);
        // Always finishes on the real reading, never on an interpolated one.
        from.current = target;
        setShown(target);
        return;
      }
      setShown({ lat: start.lat + (target.lat - start.lat) * t, lng: start.lng + (target.lng - start.lng) * t });
    }, MS / STEPS);
    return () => clearInterval(timer);
  }, [spec.point, spec.animate]);

  const look = MARKER_LOOK[spec.kind];
  return (
    <Marker
      coordinate={{ latitude: shown.lat, longitude: shown.lng }}
      // The custom view below carries no accessible name of its own.
      accessibilityLabel={spec.label}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[styles.marker, { backgroundColor: look.bg, borderColor: look.ring }]}>
        <Ionicons name={look.icon} size={16} color={look.fg} />
      </View>
    </Marker>
  );
}

const MARKER_LOOK: Record<MarkerKind, { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string; ring: string }> = {
  home: { icon: 'home', bg: palette.surface, fg: palette.primaryDeep, ring: palette.primary },
  worker: { icon: 'navigate', bg: palette.primary, fg: palette.textOnPrimary, ring: palette.surface },
  pin: { icon: 'location', bg: palette.surface, fg: palette.danger, ring: palette.danger },
};

function Unavailable({ height, title, body, style }: { height: number; title: string; body: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.frame, styles.unavailable, { height }, style]}>
      <Ionicons name="map-outline" size={26} color={palette.textMuted} />
      <Text variant="label" weight="semibold" center>
        {title}
      </Text>
      <Text variant="micro" tone="muted" center>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  unavailable: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.lg },
  marker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: palette.warningSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  noticeText: { flex: 1, color: palette.warning },
});
