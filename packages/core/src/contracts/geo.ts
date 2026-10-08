import { z } from 'zod';

/**
 * Turning a point on a map into something that can be saved as an address.
 *
 * This exists because of a gap nothing else closed: every address in the app was typed, and a
 * typed address is guessed at by the geocoder afterwards. A customer who knows exactly which of
 * four identical gates is theirs had no way to say so, and the provider arrived at the geocoder's
 * opinion instead. Dragging a pin is the only input method where the customer is the authority.
 *
 * The flow deliberately does not try to fill in a whole address from a point. No reverse geocoder
 * anywhere knows a flat number, so asking one for it and prefilling whatever came back is how you
 * end up delivering to the wrong door with full confidence. The point gives the area, the city and
 * the PIN; the person gives the part only they know.
 */
export const ResolvePointBody = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type ResolvePointBody = z.infer<typeof ResolvePointBody>;

export const ResolvedPointView = z.object({
  lat: z.number(),
  lng: z.number(),
  /** One line of human-readable place, for the strip above the "Confirm location" button. */
  formatted: z.string(),
  /** Null when the geocoder did not report one; the form then asks, rather than inventing it. */
  pincode: z.string().nullable(),
  city: z.string().nullable(),
  /**
   * Whether this point is inside the area we actually have providers in.
   *
   * Returned before anything is saved on purpose. A customer who finds out their locality is
   * unserved only after typing a full address and pressing Save has been wasted twice.
   */
  inServiceArea: z.boolean(),
  distanceFromCentreKm: z.number(),
  /**
   * True when the match is not street-level - always true while the maps adapter is the mock.
   *
   * The picker shows the prefilled PIN as a field to check rather than a fact when this is set.
   * It is the difference between "we read this off the map" and "this is roughly where you are".
   */
  coarse: z.boolean(),
});
export type ResolvedPointView = z.infer<typeof ResolvedPointView>;

/**
 * The circle the app draws on the map, and the honest state of the map behind it.
 *
 * `mapsLive` is false whenever the maps adapter is the mock. The client uses it to put a visible
 * notice on the picker instead of showing a blank grey rectangle and letting somebody conclude the
 * app is broken. A mocked integration is never presented as a working one.
 */
export const ServiceAreaView = z.object({
  centre: z.object({ lat: z.number(), lng: z.number() }),
  radiusKm: z.number(),
  city: z.string(),
  mapsLive: z.boolean(),
});
export type ServiceAreaView = z.infer<typeof ServiceAreaView>;
