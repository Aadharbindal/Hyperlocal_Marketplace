import type { FastifyInstance } from 'fastify';
import {
  AvatarUploadBody,
  CompleteProfileBody,
  ConsentBody,
  EMERGENCY_CONTACT_LIMIT,
  EmergencyContactBody,
  GrantRoleBody,
  MarkReadBody,
  NotificationSettingsBody,
  RegisterDeviceBody,
  UpdateMeBody,
  categoryForNotification,
  maskPhone,
  type AvatarUploadResponse,
  type EmergencyContactsResponse,
  type MeResponse,
} from '@hyperlocal/core';
import { newId } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import { toUserView } from '../auth/service';
import type { AppContext } from '../../app';

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services, adapters } = ctx;

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
      user: await toUserView(auth.user, roles, adapters.storage),
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
    const before = {
      display_name: auth.user.display_name,
      preferred_language: auth.user.preferred_language,
      email: auth.user.email,
      avatar_url: auth.user.avatar_url,
    };

    const patch = await buildProfilePatch(auth.userId, auth.user, body);
    const updated = await store.users.update(auth.userId, patch);

    // The customer profile's own copy of the name is kept in step. It is what the provider is
    // shown on a job card, and a customer who renames themselves and still appears under the old
    // name to the person at their door has not actually renamed themselves.
    if (body.displayName !== undefined) {
      const cp = await store.users.getCustomerProfile(auth.userId);
      if (cp) await store.users.upsertCustomerProfile({ ...cp, full_name: body.displayName });
    }

    await services.audit.record(req.auditCtx(), { action: 'user.updated', entityType: 'user', entityId: auth.userId, before, after: patch });
    return { user: await toUserView(updated, await store.users.listRoles(auth.userId), adapters.storage) };
  });

  /**
   * Turns a validated request body into a database patch, applying the rules that are about the
   * *meaning* of these fields rather than their shape.
   *
   * Shared by PATCH /me and the first-run profile screen so the two cannot drift apart - which
   * they would, and the way they would drift is that one of them forgets to drop the verified
   * flag when the address changes.
   */
  async function buildProfilePatch(userId: string, user: { email: string | null }, body: UpdateMeBody) {
    const patch: Record<string, unknown> = {};
    if (body.displayName !== undefined) patch.display_name = body.displayName;
    if (body.preferredLanguage !== undefined) patch.preferred_language = body.preferredLanguage;

    if (body.email !== undefined) {
      if (body.email === null) {
        patch.email = null;
        patch.email_verified_at = null;
      } else if (body.email !== user.email) {
        // Asked before writing so the person gets a sentence instead of a unique-violation. This
        // is a check, not a lock: two signups racing for the same address still hit the index in
        // 0016, which is the thing that actually guarantees it.
        const taken = await store.users.findByEmail(body.email);
        if (taken && taken.id !== userId) throw new AppError('EMAIL_IN_USE');
        patch.email = body.email;
        // A new address has not been confirmed, whatever the old one's status was. Without this
        // line, changing the address would inherit the previous address's verification and the
        // flag would mean nothing.
        patch.email_verified_at = null;
      }
    }

    if (body.avatarKey !== undefined) {
      if (body.avatarKey === null) {
        patch.avatar_url = null;
      } else {
        // The client sends a key, and a key it was not granted is refused. Without this, any
        // signed-in account could point its avatar at `kyc/<someone-else>/aadhaar/...` and have
        // the API mint them a week-long signed URL for somebody's identity document.
        if (!body.avatarKey.startsWith(`avatars/${userId}/`)) throw new AppError('FORBIDDEN', { details: { field: 'avatarKey' } });
        patch.avatar_url = body.avatarKey;
      }
    }
    return patch;
  }

  /**
   * The screen that runs once, straight after the OTP, on an account that has just been created.
   *
   * This is the only moment where asking for a name is not an interruption, and it is the reason
   * the field existed in the schema for months while every profile in the app rendered a masked
   * phone number. Terms acceptance rides along in the same request rather than being a checkbox
   * somewhere else: the version agreed to is recorded with the account from its first minute.
   */
  app.post('/me/complete-profile', { preHandler: requireAction('me.update') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(CompleteProfileBody, req.body);

    const patch = await buildProfilePatch(auth.userId, auth.user, {
      displayName: body.displayName,
      ...(body.email ? { email: body.email } : {}),
      ...(body.preferredLanguage ? { preferredLanguage: body.preferredLanguage } : {}),
    });
    const updated = await store.users.update(auth.userId, patch);

    await store.users.addConsent({
      user_id: auth.userId,
      consent_type: 'TERMS',
      version: body.acceptedTermsVersion,
      granted: true,
      granted_at: new Date(),
      withdrawn_at: null,
      ip: req.ip,
    });
    // Recorded either way. "They never opted in" and "they were never asked" are different
    // facts, and only one of them is a defence.
    await store.users.addConsent({
      user_id: auth.userId,
      consent_type: 'MARKETING',
      version: body.acceptedTermsVersion,
      granted: body.marketingOptIn,
      granted_at: body.marketingOptIn ? new Date() : null,
      withdrawn_at: body.marketingOptIn ? null : new Date(),
      ip: req.ip,
    });

    await services.audit.record(req.auditCtx(), { action: 'user.profile_completed', entityType: 'user', entityId: auth.userId, after: patch });
    return reply.code(200).send({ user: await toUserView(updated, await store.users.listRoles(auth.userId), adapters.storage) });
  });

  /**
   * Hands back somewhere to PUT a profile photo. The bytes never come through this route.
   *
   * Two steps rather than a multipart upload, for the same reason job evidence works this way:
   * the API stays out of the data path, so a phone on a slow connection is not holding a request
   * handler open for thirty seconds. The key is not committed to the account until the client
   * comes back with it in PATCH /me, so an upload that is abandoned half way leaves the old
   * photo in place rather than a blank.
   */
  app.post('/me/avatar', { preHandler: requireAction('me.update') }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(AvatarUploadBody, req.body);
    // The user id is in the key, which is what makes the prefix check in buildProfilePatch
    // meaningful, and a fresh id per upload so a replaced photo never collides with a cached one.
    const key = `avatars/${auth.userId}/${newId()}`;
    const target = await adapters.storage.createUploadUrl({ key, mime: body.mime, maxBytes: body.bytes });
    const res: AvatarUploadResponse = {
      key,
      url: target.url,
      method: target.method,
      expiresAt: target.expiresAt.toISOString(),
    };
    return res;
  });

  // ------------------------------------------------------------------ emergency contacts
  /**
   * See 0016 for why this exists at all. In short: unlike a taxi, the service happens inside
   * somebody's home, at a time they have told us they will be there and usually alone.
   */
  app.get('/me/emergency-contacts', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const items = await store.users.listEmergencyContacts(auth.userId);
    const res: EmergencyContactsResponse = {
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        phoneMasked: maskPhone(c.phone_e164),
        relationship: c.relationship,
        createdAt: c.created_at.toISOString(),
      })),
      limit: EMERGENCY_CONTACT_LIMIT,
    };
    return res;
  });

  app.post('/me/emergency-contacts', { preHandler: requireAction('me.update') }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parse(EmergencyContactBody, req.body);
    let rec;
    try {
      rec = await store.users.addEmergencyContact({
        user_id: auth.userId,
        name: body.name,
        phone_e164: body.phone,
        relationship: body.relationship ?? null,
      });
    } catch (e) {
      // The cap is a database trigger, so this is the only place it can be turned into something
      // a person can read. Both stores surface it the same way - a CONFLICT carrying the
      // trigger's own message as `reason` - which they did not at first: the memory store threw a
      // bare Error and only the Postgres run showed the two modes disagreeing.
      const reason = e instanceof AppError && e.code === 'CONFLICT' ? String((e.details as { reason?: string } | undefined)?.reason ?? '') : '';
      if (reason.includes('emergency contact limit')) throw new AppError('CONTACT_LIMIT_REACHED');
      throw e;
    }
    // The number is not in the audit entry. It belongs to somebody who is not a user here and has
    // consented to nothing; that it was added at all is what needs to be on the record.
    await services.audit.record(req.auditCtx(), { action: 'user.emergency_contact_added', entityType: 'user', entityId: auth.userId, after: { id: rec.id } });
    return reply.code(201).send({
      contact: { id: rec.id, name: rec.name, phoneMasked: maskPhone(rec.phone_e164), relationship: rec.relationship, createdAt: rec.created_at.toISOString() },
    });
  });

  app.delete('/me/emergency-contacts/:id', { preHandler: requireAction('me.update', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    await store.users.removeEmergencyContact(auth.userId, id);
    await services.audit.record(req.auditCtx(), { action: 'user.emergency_contact_removed', entityType: 'user', entityId: auth.userId, after: { id } });
    return { ok: true };
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
