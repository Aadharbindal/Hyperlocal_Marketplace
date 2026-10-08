import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useServiceArea } from '@/api/geo';
import { MapCanvas } from '@/features/geo/MapCanvas';
import { palette, radius, spacing } from '@/theme';
import { Button, Card, Spacer, Text } from '@/ui';

/**
 * Where the job is, on the screen of the person who has to get there.
 *
 * Shown to the assigned professional and the technician, never the customer - they are standing in
 * it. It exists because the provider's "Working now" screen had the controls for running a job and
 * not one word about its location, so somebody who had won the work had to go back out to the feed
 * to find the street.
 *
 * The map is for recognising the place; the button hands the actual navigation to whichever app they
 * already use. Building turn-by-turn directions inside this app would be worse at it than Google
 * Maps on every axis and would have to be learned.
 */
export function DestinationCard({
  destination,
}: {
  destination: { lat: number; lng: number; formatted: string; landmark: string | null; gateInstructions: string | null };
}) {
  const area = useServiceArea();

  async function openDirections() {
    // Coordinates, not the typed line: the customer confirmed this point on a map, and it is more
    // reliable than asking a second geocoder to re-interpret the words.
    const dest = `${destination.lat},${destination.lng}`;
    const url =
      Platform.OS === 'ios'
        ? // Apple Maps is the one that is certainly installed on an iPhone. `q` gives the pin a
          // name so the driver sees the address rather than bare numbers.
          `http://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(destination.formatted)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="location" size={18} color={palette.primary} />
        <Text variant="label" weight="semibold" style={styles.flex}>
          Where to go
        </Text>
      </View>

      <MapCanvas
        height={150}
        centre={{ lat: destination.lat, lng: destination.lng }}
        spanKm={0.5}
        markers={[{ id: 'dest', point: { lat: destination.lat, lng: destination.lng }, kind: 'home', label: "The customer's address" }]}
        tilesLive={area.data?.mapsLive ?? true}
      />

      <Text variant="caption" tone="secondary">
        {destination.formatted}
      </Text>
      {destination.landmark ? (
        <Text variant="micro" tone="muted">
          {`Landmark: ${destination.landmark}`}
        </Text>
      ) : null}

      {/* Given its own box rather than a third grey line, because it is the sentence that decides
          whether somebody gets through the gate or stands outside it ringing. */}
      {destination.gateInstructions ? (
        <View style={styles.gate}>
          <Ionicons name="key-outline" size={15} color={palette.primaryDeep} />
          <Text variant="micro" style={styles.gateText}>
            {destination.gateInstructions}
          </Text>
        </View>
      ) : null}

      <Spacer h={spacing.xs} />
      <Button title="Directions" variant="secondary" size="md" icon="navigate" fullWidth onPress={() => void openDirections()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: palette.primarySoft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  gateText: { flex: 1, color: palette.primaryDeep },
});
