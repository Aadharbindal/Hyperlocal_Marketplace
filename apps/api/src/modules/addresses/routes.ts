import type { FastifyInstance } from 'fastify';
import { AddressCreate, AddressUpdate, geohash, isWithinRadius, type AddressView } from '@hyperlocal/core';
import { z } from 'zod';
import type { AddressRecord } from '../../data/types';
import { forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });

export function toAddressView(a: AddressRecord): AddressView {
  return {
    id: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    societyName: a.society_name,
    gateInstructions: a.gate_instructions,
    city: a.city,
    pincode: a.pincode,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.is_default,
    inPilotZone: a.in_pilot_zone,
    createdAt: a.created_at.toISOString(),
  };
}

export async function addressRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, adapters, env, services } = ctx;
  const pilotCenter = { lat: env.PILOT_CENTER_LAT, lng: env.PILOT_CENTER_LNG };

  async function ownedAddress(req: Parameters<typeof requireAuth>[0], id: string) {
    const auth = requireAuth(req);
    const a = await store.addresses.get(id);
    if (!a || a.deleted_at) throw notFound('address');
    if (a.user_id !== auth.userId) throw forbidden('not your address');
    return { auth, a };
  }

  app.get('/me/addresses', { preHandler: requireAction('address.manage', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const items = await store.addresses.list(auth.userId);
    return { items: items.map(toAddressView) };
  });

  app.post('/me/addresses', { preHandler: requireAction('address.manage') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(AddressCreate, req.body);
    let lat = body.lat;
    let lng = body.lng;
    if (lat === undefined || lng === undefined) {
      const g = await adapters.maps.geocode({ line1: body.line1, line2: body.line2, city: body.city, pincode: body.pincode });
      lat = g.lat;
      lng = g.lng;
    }
    const point = { lat, lng };
    const existing = await store.addresses.list(auth.userId);
    const makeDefault = body.isDefault ?? existing.length === 0;
    const created = await store.transaction(async (tx) => {
      if (makeDefault) await tx.addresses.clearDefault(auth.userId);
      return tx.addresses.create({
        user_id: auth.userId,
        label: body.label,
        line1: body.line1,
        line2: body.line2 ?? null,
        landmark: body.landmark ?? null,
        society_name: body.societyName ?? null,
        gate_instructions: body.gateInstructions ?? null,
        city: body.city,
        pincode: body.pincode,
        lat: point.lat,
        lng: point.lng,
        geohash: geohash(point),
        is_default: makeDefault,
        in_pilot_zone: isWithinRadius(pilotCenter, point, env.PILOT_RADIUS_KM),
        deleted_at: null,
      });
    });
    await services.audit.record(req.auditCtx(), { action: 'address.created', entityType: 'address', entityId: created.id });
    return reply.code(201).send(toAddressView(created));
  });

  app.patch('/me/addresses/:id', { preHandler: requireAction('address.manage') }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { auth, a } = await ownedAddress(req, id);
    const body = parse(AddressUpdate, req.body);
    const patch: Partial<AddressRecord> = {};
    if (body.label !== undefined) patch.label = body.label;
    if (body.line1 !== undefined) patch.line1 = body.line1;
    if (body.line2 !== undefined) patch.line2 = body.line2;
    if (body.landmark !== undefined) patch.landmark = body.landmark;
    if (body.societyName !== undefined) patch.society_name = body.societyName;
    if (body.gateInstructions !== undefined) patch.gate_instructions = body.gateInstructions;
    if (body.city !== undefined) patch.city = body.city;
    if (body.pincode !== undefined) patch.pincode = body.pincode;
    const moved = body.lat !== undefined && body.lng !== undefined;
    const readdressed = body.line1 !== undefined || body.pincode !== undefined || body.city !== undefined;
    if (moved || readdressed) {
      const point = moved
        ? { lat: body.lat!, lng: body.lng! }
        : await adapters.maps.geocode({ line1: patch.line1 ?? a.line1, line2: patch.line2 ?? a.line2 ?? undefined, city: patch.city ?? a.city, pincode: patch.pincode ?? a.pincode });
      patch.lat = point.lat;
      patch.lng = point.lng;
      patch.geohash = geohash(point);
      patch.in_pilot_zone = isWithinRadius(pilotCenter, point, env.PILOT_RADIUS_KM);
    }
    const updated = await store.transaction(async (tx) => {
      if (body.isDefault) {
        await tx.addresses.clearDefault(auth.userId);
        patch.is_default = true;
      }
      return tx.addresses.update(id, patch);
    });
    await services.audit.record(req.auditCtx(), { action: 'address.updated', entityType: 'address', entityId: id, after: body });
    return toAddressView(updated);
  });

  app.delete('/me/addresses/:id', { preHandler: requireAction('address.manage') }, async (req) => {
    const { id } = parse(IdParam, req.params);
    await ownedAddress(req, id);
    await store.addresses.update(id, { deleted_at: new Date(), is_default: false });
    await services.audit.record(req.auditCtx(), { action: 'address.deleted', entityType: 'address', entityId: id });
    return { ok: true };
  });
}
