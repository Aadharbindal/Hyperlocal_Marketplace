import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  checkAddressLine,
  checkCity,
  checkPincode,
  type FieldProblem,
  type LatLng,
  type ResolvedPointView,
} from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useMyLocation, useResolvePoint, useServiceArea } from '@/api/geo';
import { useAddresses, useCreateAddress, useUpdateAddress } from '@/api/jobs';
import { MapCanvas, mapsAvailable, type MapCanvasHandle } from '@/features/geo/MapCanvas';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Card, Screen, Spacer, Text } from '@/ui';

/**
 * Picking where you live by pointing at it.
 *
 * Every address in this app used to be typed, which meant the coordinates a professional navigated
 * to were the geocoder's guess at what somebody had written. For "12, Lodhi Colony" that guess is
 * fine. For a plot number in an unnumbered lane, a flat behind a market, or any of the four gates of
 * one society, it is a coin toss - and the cost of losing it is a worker ringing the wrong bell
 * while somebody waits inside with a leaking tap. The person standing in the place is the only
 * authority on where it is, so this screen lets them say so, and then saves their coordinates
 * instead of asking the geocoder.
 *
 * Two stages, in the order the big delivery apps settled on after the same realisation:
 *
 *  1. the map - drag until the pin is on your gate, and find out *before typing anything* whether
 *     we even work in that locality;
 *  2. the details - the flat number and the floor, which no reverse geocoder on earth knows and
 *     which are therefore asked for rather than guessed.
 *
 * What it refuses to do is fill in stage 2 from stage 1 and call it done. A prefilled PIN code from
 * a neighbourhood centroid is shown as a field to check, never as a fact, and whether it needed
 * checking at all is something the server tells us.
 */
export default function AddressPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const area = useServiceArea();
  const resolve = useResolvePoint();
  const { locate, state: locating } = useMyLocation();
  const addresses = useAddresses();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const mapRef = useRef<MapCanvasHandle>(null);

  const editing = params.id ? addresses.data?.items.find((a) => a.id === params.id) : undefined;

  /**
   * Whether there is a map to pick on at all.
   *
   * On web, or in a build without the native module, there is not - and the honest response is to
   * skip the map stage rather than show an empty box above a Confirm button that would quietly save
   * the pilot centre as somebody's home. Typing the address still works: the server geocodes it,
   * exactly as it did before this screen existed.
   */
  const canMap = mapsAvailable();

  const [stage, setStage] = useState<'map' | 'details'>(canMap ? 'map' : 'details');
  /** What the pin is over right now. Updated on every settle; not the same as what was confirmed. */
  const [point, setPoint] = useState<LatLng | null>(null);
  const [resolved, setResolved] = useState<ResolvedPointView | null>(null);
  const [confirmed, setConfirmed] = useState<ResolvedPointView | null>(null);

  const [label, setLabel] = useState('Home');
  const [line1, setLine1] = useState('');
  const [landmark, setLandmark] = useState('');
  const [gate, setGate] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Where the map opens.
   *
   * An address being edited wins, because the person came here to nudge a pin that already exists.
   * Otherwise the pilot centre, which is a better first guess than the middle of the ocean and, more
   * to the point, means the screen is usable before anybody has decided about the location prompt.
   */
  const start: LatLng | null = editing
    ? { lat: editing.lat, lng: editing.lng }
    : area.data
      ? area.data.centre
      : null;

  // Prefill from the address being edited, once its list has arrived.
  const seeded = useRef(false);
  useEffect(() => {
    if (!editing || seeded.current) return;
    seeded.current = true;
    setLabel(editing.label ?? 'Home');
    setLine1(editing.line1);
    setLandmark(editing.landmark ?? '');
    setGate(editing.gateInstructions ?? '');
    setCity(editing.city);
    setPincode(editing.pincode);
  }, [editing]);

  /**
   * Resolving the centre after the map stops moving, but not on every stop.
   *
   * A drag across a city fires `onRegionChangeComplete` once per pause, and each one is a paid
   * upstream geocode. Half a second of stillness is the difference between somebody having stopped
   * and somebody adjusting their grip.
   */
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSettle = (p: LatLng) => {
    setPoint(p);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      resolve
        .mutateAsync(p)
        .then(setResolved)
        // A failed lookup leaves the pin exactly where it is and the button still usable: the
        // coordinates are the part that matters, and the person can type the rest.
        .catch(() => setResolved(null));
    }, 550);
  };
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  // The first resolve, for the point the map opened on - nobody has dragged anything yet.
  const opened = useRef(false);
  useEffect(() => {
    if (!start || opened.current) return;
    opened.current = true;
    setPoint(start);
    resolve.mutateAsync(start).then(setResolved).catch(() => setResolved(null));
  }, [start?.lat, start?.lng]);

  const useMyLocationPress = async () => {
    const p = await locate();
    if (!p) return;
    mapRef.current?.moveTo(p, { zoomKm: 0.5 });
    // The camera move will settle and resolve on its own, so nothing is requested twice here.
  };

  const confirmLocation = () => {
    if (!point) return;
    const r = resolved ?? {
      ...point,
      formatted: '',
      pincode: null,
      city: null,
      // Unknown rather than assumed in either direction. The save endpoint decides for real.
      inServiceArea: true,
      distanceFromCentreKm: 0,
      coarse: true,
    };
    setConfirmed({ ...r, lat: point.lat, lng: point.lng });
    // Only fills a field that is still empty, so coming back to the map after typing a PIN does not
    // overwrite what somebody carefully corrected.
    if (!city && r.city) setCity(r.city);
    if (!pincode && r.pincode) setPincode(r.pincode);
    setStage('details');
  };

  // A confirmed pin is not in this list on purpose: without a map there is none to confirm, and the
  // three fields below are exactly what the typed path has always needed.
  const complete = line1.trim().length >= 3 && city.trim().length >= 2 && /^[1-8]\d{5}$/.test(pincode.trim());

  const save = async () => {
    setError(null);
    try {
      const body = {
        label: label.trim() || 'Home',
        line1: line1.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
        ...(gate.trim() ? { gateInstructions: gate.trim() } : {}),
        // The whole reason this screen exists. Sending coordinates means the server does not
        // geocode, so what gets stored is the spot the person pointed at. Left out when there was no
        // map to point at, and then the server geocodes the typed lines as it always has.
        ...(confirmed ? { lat: confirmed.lat, lng: confirmed.lng } : {}),
      };
      if (params.id) await update.mutateAsync({ id: params.id, ...body });
      else await create.mutateAsync(body);
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'VALIDATION_ERROR'
            ? 'Check the flat number, city and PIN code.'
            : e.message
          : 'That did not save. Please try again.',
      );
    }
  };

  const tilesLive = area.data?.mapsLive ?? true;

  if (stage === 'details') {
    return (
      <Screen keyboard>
        <View style={styles.header}>
          <Pressable
            onPress={() => (canMap ? setStage('map') : router.back())}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={canMap ? 'Back to the map' : 'Go back'}
          >
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <Text variant="title" weight="bold" style={styles.flex}>
            Address details
          </Text>
        </View>
        <Spacer h={spacing.lg} />

        {confirmed ? (
        <Animated.View entering={FadeInDown.duration(320)}>
          <MapCanvas
            height={140}
            centre={{ lat: confirmed.lat, lng: confirmed.lng }}
            spanKm={0.4}
            markers={[{ id: 'pin', point: { lat: confirmed.lat, lng: confirmed.lng }, kind: 'pin', label: 'The spot you chose' }]}
            tilesLive={tilesLive}
          />
          <Spacer h={spacing.sm} />
          <View style={styles.confirmedRow}>
            <Ionicons name="location" size={16} color={palette.primary} />
            <Text variant="micro" tone="secondary" style={styles.flex} numberOfLines={2}>
              {confirmed.formatted || `${confirmed.lat.toFixed(5)}, ${confirmed.lng.toFixed(5)}`}
            </Text>
            <Button title="Change" size="sm" variant="ghost" onPress={() => setStage('map')} />
          </View>
        </Animated.View>
        ) : null}

        <Spacer h={spacing.lg} />

        <Card padding="lg" style={styles.form}>
          {/* Asked, never guessed. This is the half of an address no map can know. */}
          <Field
            label="Flat / house number, building"
            value={line1}
            onChange={setLine1}
            placeholder="B-14, Sunrise Apartments"
            autoCapitalize="words"
            validate={checkAddressLine}
          />
          <Field label="Landmark (optional)" value={landmark} onChange={setLandmark} placeholder="Opposite the park gate" />
          <Field
            label="How to get in (optional)"
            value={gate}
            onChange={setGate}
            placeholder="Tell the guard flat B-14; lift is on the left"
          />
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Field label="City" value={city} onChange={setCity} placeholder="Delhi" autoCapitalize="words" validate={checkCity} />
            </View>
            <View style={styles.pin}>
              <Field label="PIN code" value={pincode} onChange={setPincode} placeholder="110003" keyboardType="number-pad" maxLength={6} validate={checkPincode} />
            </View>
          </View>

          {/* Shown only when the match was not street-level. With a rooftop match these two fields
              came off the map and saying "please check" would be noise. */}
          {confirmed?.coarse && (confirmed.pincode || confirmed.city) ? (
            <View style={styles.checkNote}>
              <Ionicons name="alert-circle-outline" size={15} color={palette.warning} />
              <Text variant="micro" style={styles.checkNoteText}>
                We filled the city and PIN from roughly where the pin is. Please check them - a wrong
                PIN sends the booking to the wrong area.
              </Text>
            </View>
          ) : null}

          <View style={styles.labels}>
            <Text variant="caption" tone="secondary">
              Name it
            </Text>
            <View style={styles.labelRow}>
              {(['Home', 'Work', 'Other'] as const).map((l) => (
                <Pressable
                  key={l}
                  onPress={() => setLabel(l)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: label === l }}
                  style={[styles.labelChip, label === l && styles.labelChipOn]}
                >
                  <Text variant="caption" weight="semibold" style={label === l ? styles.labelChipOnText : undefined}>
                    {l}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {error ? (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          ) : null}

          <Button
            title={params.id ? 'Save changes' : 'Save address'}
            fullWidth
            icon="checkmark"
            disabled={!complete}
            loading={create.isPending || update.isPending}
            onPress={() => void save()}
          />
          <Text variant="micro" tone="muted">
            We only show the full address to the professional who is actually coming, and only once
            the booking is confirmed.
          </Text>
        </Card>
        <Spacer h={spacing.xxl} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.mapStage}>
        {start ? (
          <MapCanvas
            ref={mapRef}
            // Fills everything the sheet is not covering.
            height={10_000}
            centre={start}
            spanKm={editing ? 0.5 : 2.4}
            interactive
            onRegionSettle={onSettle}
            serviceArea={area.data ? { centre: area.data.centre, radiusKm: area.data.radiusKm } : null}
            tilesLive={tilesLive}
            style={styles.mapFill}
          />
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={palette.primary} />
          </View>
        )}

        {/* The pin is a fixed overlay, not a marker: the map moves under it. Dragging a marker means
            chasing a small target with a fingertip that is covering it, where this puts the thing
            being aimed at in the middle of the screen and the finger anywhere else. */}
        <View style={styles.crosshair} pointerEvents="none">
          <Ionicons name="location" size={38} color={palette.danger} />
          <View style={styles.crosshairDot} />
        </View>

        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back" style={styles.floatingBack}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>

        <Pressable
          onPress={() => void useMyLocationPress()}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
          style={styles.locateBtn}
        >
          {locating === 'asking' || locating === 'locating' ? (
            <ActivityIndicator size="small" color={palette.primaryDeep} />
          ) : (
            <Ionicons name="locate" size={20} color={palette.primaryDeep} />
          )}
        </Pressable>
      </View>

      <Animated.View entering={FadeIn.duration(260)} style={styles.sheet}>
        <Text variant="label" weight="bold">
          {editing ? 'Move the pin to the right spot' : 'Where exactly?'}
        </Text>
        <Spacer h={spacing.xs} />
        <Text variant="micro" tone="muted">
          Drag the map so the pin sits on your gate or building door.
        </Text>
        <Spacer h={spacing.md} />

        <View style={styles.resolvedRow}>
          <Ionicons name="navigate-circle-outline" size={18} color={palette.primary} />
          {resolve.isPending ? (
            <Text variant="caption" tone="muted" style={styles.flex}>
              Finding this place...
            </Text>
          ) : (
            <Text variant="caption" tone="secondary" style={styles.flex} numberOfLines={2}>
              {resolved?.formatted ||
                (point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Move the map to choose a spot')}
            </Text>
          )}
        </View>

        {/* The question answered before anybody types a word, which is the only kind thing to do
            with it. Finding out after filling in a whole form is being wasted twice. */}
        {resolved && !resolved.inServiceArea ? (
          <>
            <Spacer h={spacing.md} />
            <View style={styles.outside}>
              <Ionicons name="information-circle" size={17} color={palette.warning} />
              <Text variant="micro" style={styles.outsideText}>
                {`We are not working here yet - this spot is about ${resolved.distanceFromCentreKm} km from our ${area.data?.city ?? 'service'} area. You can still save the address, but bookings will not be offered for it.`}
              </Text>
            </View>
          </>
        ) : null}

        {locating === 'denied' ? (
          <>
            <Spacer h={spacing.sm} />
            <Text variant="micro" tone="muted">
              Location is off for this app, so drag the map instead. Nothing else on this screen needs
              it.
            </Text>
          </>
        ) : locating === 'unavailable' || locating === 'failed' ? (
          <>
            <Spacer h={spacing.sm} />
            <Text variant="micro" tone="muted">
              We could not get a fix just now - indoors this is common. Drag the map instead.
            </Text>
          </>
        ) : null}

        <Spacer h={spacing.lg} />
        <Button
          title="Confirm location"
          fullWidth
          iconRight="arrow-forward"
          // Enabled as long as there is a point. An unresolved or out-of-zone pin is still a real
          // place somebody lives, and refusing to let them save it would be us deciding their
          // address does not exist.
          disabled={!point}
          onPress={confirmLocation}
        />
        {resolved && resolved.inServiceArea ? (
          <>
            <Spacer h={spacing.sm} />
            <Badge tone="success" icon="checkmark-circle" label="We work in this area" />
          </>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

/**
 * The same blur-validated field `addresses.tsx` uses.
 *
 * Duplicated rather than shared for now because the two screens are about to become one: this one
 * replaces the typing form, and when the old screen's form goes this copy is the only one left.
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  maxLength,
  autoCapitalize,
  validate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'number-pad';
  maxLength?: number;
  autoCapitalize?: 'words';
  validate?: (v: string) => FieldProblem | null;
}) {
  const [problem, setProblem] = useState<FieldProblem | null>(null);
  return (
    <View style={styles.field}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setProblem(null)}
        onBlur={() => setProblem(validate && value.trim() ? validate(value) : null)}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        style={[styles.input, problem && styles.inputBad]}
        accessibilityLabel={label}
      />
      {problem ? (
        <Text variant="micro" tone="danger">
          {problem.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.screen, paddingTop: spacing.md },
  mapStage: { flex: 1, position: 'relative' },
  mapFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0, borderWidth: 0 },
  mapLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
  crosshair: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // The pin's point is at its bottom, so it is nudged up by half its height to sit on the centre.
  crosshairDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: palette.danger, marginTop: 19 },
  floatingBack: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.screen,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateBtn: {
    position: 'absolute',
    right: spacing.screen,
    bottom: spacing.lg,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  resolvedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  outside: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: palette.warningSoft, borderRadius: radius.sm, padding: spacing.md },
  outsideText: { flex: 1, color: palette.warning },
  checkNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: palette.warningSoft, borderRadius: radius.sm, padding: spacing.md },
  checkNoteText: { flex: 1, color: palette.warning },
  form: { gap: spacing.md },
  pair: { flexDirection: 'row', gap: spacing.md },
  pin: { width: 130 },
  field: { gap: spacing.xs },
  labels: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', gap: spacing.sm },
  labelChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    minHeight: 40,
    justifyContent: 'center',
  },
  labelChipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  labelChipOnText: { color: palette.textOnPrimary },
  inputBad: { borderColor: palette.danger },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
    color: palette.text,
  },
});
