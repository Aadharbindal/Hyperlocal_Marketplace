import type { FastifyInstance } from 'fastify';
import {
  ConsentBody,
  GrantRoleBody,
  MarkReadBody,
  NotificationSettingsBody,
  RegisterDeviceBody,
  UpdateMeBody,
  categoryForNotification,
  type MeResponse,
} from '@hyperlocal/core';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import { toUserView } from '../auth/service';
import type { AppContext } from '../../app';

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;

  app.get('/me', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const [roles, consents, customer, provider, vendor, contractor] = await Promise.all([
      store.users.listRoles(auth.userId),
      store.users.listConsents(auth.userId),
      store.users.getCustomerProfile(auth.userId),
      store.users.getProviderProfile(auth.userId),
      store.users.getVendorProfile(auth.userId),
      store.users.getContractorProfile(auth.userId),
    ]);
    // Latest consent per type wins.
    const latest = new Map<string, (typeof consents)[number]>();
    for (const c of consents) latest.set(c.consent_type, c);
    const res: MeResponse = {
      user: toUserView(auth.user, roles),
      consents: [...latest.values()].map((c) => ({
        type: c.consent_type,
        version: c.version,
        granted: c.granted,
        grantedAt: c.granted_at?.toISOString() ?? null,
        withdrawnAt: c.withdrawn_at?.toISOString() ?? null,
      })),
      profiles: {
        customer: customer ? { fullName: customer.full_name, email: customer.email } : null,
        provider: provider
          ? { businessName: provider.business_name, verificationStatus: provider.verification_status, isAvailable: provider.is_available, serviceRadiusKm: Number(provider.service_radius_km) }
          : null,
        vendor: vendor ? { shopName: vendor.shop_name, verificationStatus: vendor.verification_status } : null,
        contractor: contractor ? { businessName: contractor.business_name, verificationStatus: contractor.verification_status } : null,
      },
    };
    return res;
  });

  app.patch('/me', { preHandler: requireAction('me.update') }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(UpdateMeBody, req.body);
    const before = { display_name: auth.user.display_name, preferred_language: auth.user.preferred_language };
    const updated = await store.users.update(auth.userId, {
      ...(body.displayName !== undefined ? { display_name: body.displayName } : {}),
      ...(body.preferredLanguage !== undefined ? { preferred_language: body.preferredLanguage } : {}),
    });
    await services.audit.record(req.auditCtx(), { action: 'user.updated', entityType: 'user', entityId: auth.userId, before, after: body });
    return { user: toUserView(updated, await store.users.listRoles(auth.userId)) };
  });

  app.post('/me/roles', { preHandler: requireAction('me.role.grant_self') }, async (req, reply) => {
    const auth = requireAuth(req);
    const r = GrantRoleBody.safeParse(req.body);
    if (!r.success) {
      const notSelf = r.error.issues.some((i) => i.message.includes('self-assigned'));
      throw new AppError(notSelf ? 'ROLE_NOT_SELF_SERVICE' : 'VALIDATION_ERROR', { details: r.error.issues });
    }
    const role = r.data.role;
    const existing = (await store.users.listRoles(auth.userId)).find((x) => x.role === role);
    if (existing && existing.status === 'ACTIVE') return reply.code(200).send({ role, status: 'ACTIVE', alreadyGranted: true });
    if (existing && existing.status === 'SUSPENDED') throw new AppError('AUTH_SUSPENDED');
    await store.users.grantRole({ user_id: auth.userId, role, granted_by: auth.userId });
    if (role === 'CUSTOMER' && !(await store.users.getCustomerProfile(auth.userId))) {
      await store.users.upsertCustomerProfile({ user_id: auth.userId, full_name: auth.user.display_name, email: null, default_address_id: null, marketing_opt_in: false });
    }
    if (role === 'PROVIDER' && !(await store.users.getProviderProfile(auth.userId))) {
      await store.users.upsertProviderProfile({
        user_id: auth.userId, business_name: null, bio: null, experience_years: null, service_radius_km: 3, base_lat: null, base_lng: null,
        is_available: false, verification_status: 'UNVERIFIED', reliability_score: 5, rating_avg: null, rating_count: 0, completed_jobs: 0, strike_count: 0, contractor_id: null, suspended_until: null,
      });
    }
    if (role === 'CONTRACTOR' && !(await store.users.getContractorProfile(auth.userId))) {
      await store.users.upsertContractorProfile({ user_id: auth.userId, business_name: null, verification_status: 'UNVERIFIED', base_lat: null, base_lng: null, service_radius_km: 5 });
    }
    if (role === 'VENDOR' && !(await store.users.getVendorProfile(auth.userId))) {
      await store.users.upsertVendorProfile({ user_id: auth.userId, shop_name: null, shop_address_id: null, delivery_radius_km: 3, material_categories: [], delivery_available: false, verification_status: 'UNVERIFIED' });
    }
    await services.audit.record(req.auditCtx(), { action: 'role.granted', entityType: 'user', entityId: auth.userId, after: { role } });
    return reply.code(201).send({ role, status: 'ACTIVE', alreadyGranted: false });
  });

  app.post('/me/consents', { preHandler: requireAction('me.consent.write', { allowSuspended: true }) }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(ConsentBody, req.body);
    const rec = await store.users.addConsent({
      user_id: auth.userId,
      consent_type: body.type,
      version: body.version,
      granted: body.granted,
      granted_at: body.granted ? new Date() : null,
      withdrawn_at: body.granted ? null : new Date(),
      ip: req.ip,
    });
    await services.audit.record(req.auditCtx(), { action: body.granted ? 'consent.granted' : 'consent.withdrawn', entityType: 'consent', entityId: rec.id, after: body });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/me', { preHandler: requireAction('me.delete', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const scheduledFor = new Date(Date.now() + 30 * 24 * 3600_000);
    await store.users.update(auth.userId, { status: 'DELETION_SCHEDULED' });
    await store.retention.schedule({ entity_type: 'user', entity_id: auth.userId, action: 'ANONYMISE', scheduled_for: scheduledFor, executed_at: null, reason: 'user requested deletion' });
    await store.auth.revokeAllSessions(auth.userId);
    await services.audit.record(req.auditCtx(), { action: 'user.deletion_requested', entityType: 'user', entityId: auth.userId, after: { scheduledFor } });
    return { ok: true, scheduledFor: scheduledFor.toISOString(), retained: 'Financial, dispute and audit records are kept as required by law.' };
  });

  app.get('/me/notifications', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const [items, unread] = await Promise.all([
      store.notifications.listForUser(auth.userId, 50),
      store.notifications.countUnread(auth.userId),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        category: categoryForNotification(n.type),
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.read_at?.toISOString() ?? null,
        createdAt: n.created_at.toISOString(),
      })),
      unread,
    };
  });

  /** Reading is not an action with consequences, so it needs no reason and no audit entry. */
  app.post('/me/notifications/read', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { ids } = parse(MarkReadBody, req.body ?? {});
    const marked = await store.notifications.markRead(auth.userId, ids);
    return { marked, unread: await store.notifications.countUnread(auth.userId) };
  });

  // -------------------------------------------------------------------- devices
  /**
   * The app registers its push token here on every launch, because the operating system rotates
   * it and a stale token is a person who quietly stops hearing from us. Registering the same
   * token twice is the normal case, not an error.
   */
  app.post('/me/devices', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(RegisterDeviceBody, req.body);
    const device = await store.reach.upsertDevice({
      user_id: auth.userId,
      token: body.token,
      platform: body.platform,
      device_label: body.deviceLabel ?? null,
      app_version: body.appVersion ?? null,
    });
    return { device: { id: device.id, platform: device.platform, deviceLabel: device.device_label } };
  });

  app.get('/me/devices', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    // The token itself is never returned: it is a handle to somebody's phone, and the list is
    // for recognising a device, not for using it.
    const currentToken = typeof req.headers['x-device-token'] === 'string' ? req.headers['x-device-token'] : null;
    const items = (await store.reach.listDevices(auth.userId)).map((d) => ({
      id: d.id,
      platform: d.platform,
      deviceLabel: d.device_label,
      isThisDevice: !!currentToken && d.token === currentToken,
      lastSeenAt: d.last_seen_at.toISOString(),
      createdAt: d.created_at.toISOString(),
    }));
    return { items };
  });

  /** Signing a device out of notifications. The row is kept, so a device that returns is recognised. */
  app.delete('/me/devices/:id', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    await store.reach.removeDevice(auth.userId, id);
    return { ok: true };
  });

  // -------------------------------------------------------------------- what we may send
  app.get('/me/notification-settings', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    return settingsView(auth.user);
  });

  app.patch('/me/notification-settings', { preHandler: requireAction('me.update', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(NotificationSettingsBody, req.body ?? {});
    const updated = await store.users.update(auth.userId, {
      ...(body.jobUpdates === undefined ? {} : { push_job_updates: body.jobUpdates }),
      ...(body.offers === undefined ? {} : { push_offers: body.offers }),
      ...(body.marketing === undefined ? {} : { push_marketing: body.marketing }),
    });
    await services.audit.record(req.auditCtx(), {
      action: 'user.notification_settings_changed',
      entityType: 'user',
      entityId: auth.userId,
      after: body,
    });
    return settingsView(updated);
  });

  function settingsView(u: { push_job_updates: boolean; push_offers: boolean; push_marketing: boolean }) {
    return {
      jobUpdates: u.push_job_updates,
      offers: u.push_offers,
      marketing: u.push_marketing,
      // Said out loud so the settings screen can explain why there is no switch for these,
      // rather than leaving someone to wonder whether we are ignoring one.
      alwaysOn: ['MONEY', 'ACCOUNT'] as const,
    };
  }
}
