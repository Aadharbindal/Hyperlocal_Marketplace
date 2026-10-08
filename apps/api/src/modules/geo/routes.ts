import type { FastifyInstance } from 'fastify';
import { ResolvePointBody, haversineKm, isWithinRadius, type ResolvedPointView, type ServiceAreaView } from '@hyperlocal/core';
import { parse } from '../../lib/validate';
import { requireAction } from '../../plugins/auth';
import type { AppContext } from '../../app';

/**
 * The two things a map-backed address picker needs from the server.
 *
 * Both are deliberately thin. The client owns the map, the pin and the gestures; the server owns
 * the only two facts the client cannot know - where our providers actually are, and what a
 * geocoder makes of a given point.
 */
export async function geoRoutes(app: FastifyInstance, ctx: AppContext) {
  const { adapters, env } = ctx;
  const centre = { lat: env.PILOT_CENTER_LAT, lng: env.PILOT_CENTER_LNG };

  /**
   * Public, because it is what lets the app say "we are not in your city yet" before asking anybody
   * to sign in. There is nothing private in it: the pilot area is on the marketing page.
   */
  app.get('/geo/service-area', async (): Promise<ServiceAreaView> => {
    return {
      centre,
      radiusKm: env.PILOT_RADIUS_KM,
      city: env.PILOT_CITY,
      // The one field that keeps this honest. False means the tiles on the client are not Google's
      // and the resolved addresses below are the mock's invention.
      mapsLive: !adapters.maps.isMock,
    };
  });

  /**
   * A point the customer dragged a pin to, turned into something saveable.
   *
   * Authenticated and rate-limited harder than the rest of the API, for two unrelated reasons: a
   * dragged pin fires this on every settle and each call costs money upstream, and the body is
   * somebody's precise location, which is not something to let an unauthenticated caller mine.
   *
   * POST rather than GET with query parameters, for that second reason - coordinates in a URL end
   * up in access logs, proxy logs and referrers.
   */
  app.post(
    '/geo/resolve-point',
    {
      preHandler: requireAction('address.manage'),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<ResolvedPointView> => {
      const body = parse(ResolvePointBody, req.body);
      const point = { lat: body.lat, lng: body.lng };
      const r = await adapters.maps.reverseGeocode(point);
      return {
        lat: point.lat,
        lng: point.lng,
        formatted: r.formatted,
        pincode: r.pincode ?? null,
        city: r.city ?? null,
        inServiceArea: isWithinRadius(centre, point, env.PILOT_RADIUS_KM),
        // Rounded to a tenth of a km. The exact figure is a haversine artefact, and "2.4 km outside"
        // is the whole of what a person reads it for.
        distanceFromCentreKm: Math.round(haversineKm(centre, point) * 10) / 10,
        coarse: r.coarse,
      };
    },
  );
}
