import type { FastifyInstance } from 'fastify';
import {
  EXPORT_EXCLUSIONS,
  EXPORT_SECTIONS,
  ModerateMessageBody,
  RECOVERY_CODE_COUNT,
  SearchQuery,
  UseRecoveryCodeBody,
  formatRecoveryCode,
  haversineKm,
  isPlausibleRecoveryCode,
  moderationIsOverdue,
  normaliseRecoveryCode,
  outcomeIsPunitive,
  outcomeNeedsReason,
  recoveryCodeFromBytes,
  searchCatalog,
  searchSuggestions,
  type PublicProviderView,
} from '@hyperlocal/core';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { sha256 } from '../../lib/crypto';
import { parse } from '../../lib/validate';
import { requireAction, requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * Four holes closed: a customer being able to look at somebody before booking them, a search box
 * that searches, a moderation queue somebody reads, and the two things the law and an incident
 * would each ask for - a data export and a way back in after a lost phone.
 */
export async function trustRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services, env } = ctx;

  // ---------------------------------------------------------------- who am I hiring
  /**
   * The profile a customer sees before choosing between offers.
   *
   * Deliberately not a user record: no phone number, no address, no documents, no exact
   * location. Somebody comparing four offers needs to know whether this person is any good -
   * not who they are and where they live. Until now the only thing exposed was a list of
   * reviews, which made the marketplace an auction on price, and PRODUCT_SPEC section 10 is
   * explicit that it should not be one.
   */
  app.get('/providers/:id', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(IdParam, req.params);

    const [profile, user, skillIds, categories, reviews] = await Promise.all([
      store.users.getProviderProfile(id),
      store.users.findById(id),
      store.users.listProviderSkills(id),
      store.categories.listEnabled(),
      store.finance.listReviewsFor(id, 20),
    ]);
    if (!profile || !user) throw notFound('provider');

    const allSkills = await store.categories.listSkills(categories.map((c) => c.id));
    const mine = allSkills.filter((s) => skillIds.includes(s.id));
    const categoryIds = new Set(mine.map((s) => s.category_id));

    // Distance from the customer's default address, rounded. "About 3 km away" is what somebody
    // needs; an exact figure is a location, and a provider's home is not ours to give out.
    const addresses = await store.addresses.list(auth.userId);
    const home = addresses.find((a) => a.is_default) ?? addresses[0];
    const approxDistanceKm =
      home?.lat != null && home.lng != null && profile.base_lat != null && profile.base_lng != null
        ? Math.round(haversineKm({ lat: home.lat, lng: home.lng }, { lat: profile.base_lat, lng: profile.base_lng }) * 2) / 2
        : null;

    const breakdown = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((r) => r.rating === stars).length }));

    const view: PublicProviderView = {
      providerId: id,
      businessName: profile.business_name ?? 'Service professional',
      contactName: user.display_name?.split(' ')[0] ?? null,
      verificationStatus: profile.verification_status,
      ratingAvg: profile.rating_avg ?? 0,
      ratingCount: profile.rating_count ?? 0,
      completedJobs: profile.completed_jobs ?? 0,
      experienceYears: profile.experience_years ?? null,
      bio: profile.bio ?? null,
      categories: categories.filter((c) => categoryIds.has(c.id)).map((c) => c.name_en),
      skills: mine.map((s) => s.name_en),
      approxDistanceKm,
      memberSince: user.created_at.toISOString(),
      isFavourite: await store.growth.isFavourite(auth.userId, id),
      reviews: await Promise.all(
        reviews.map(async (r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          // A first name only, as everywhere else a counterparty is shown.
          reviewerName: (await store.users.findById(r.reviewer_id))?.display_name?.split(' ')[0] ?? 'A customer',
          createdAt: r.created_at.toISOString(),
        })),
      ),
      // A 4.6 from three people is not a 4.6 from three hundred, and the breakdown is the only
      // honest way to show that.
      ratingBreakdown: breakdown,
    };
    return { provider: view };
  });

  // ---------------------------------------------------------------- search
  /**
   * The box at the top of the home screen, which has been a stub since M2.
   *
   * People do not type category names. They type "tap leaking", "गीजर", "fan not working" - so
   * this matches the words they use, in both languages, rather than expecting them to learn our
   * taxonomy.
   */
  app.get('/search', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const { q, limit } = parse(SearchQuery, req.query);
    const lang = auth.user.preferred_language === 'hi' ? 'hi' : 'en';

    const categories = await store.categories.listEnabled();
    const skills = await store.categories.listSkills(categories.map((c) => c.id));
    const catalog = {
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, nameEn: c.name_en, nameHi: c.name_hi })),
      skills: skills.map((s) => ({ id: s.id, categoryId: s.category_id, slug: s.slug, nameEn: s.name_en, nameHi: s.name_hi })),
    };

    const hits = q ? searchCatalog(q, catalog, lang, limit) : [];
    // Never a blank panel: a search that shows nothing before you type reads as broken.
    const recent = await store.jobs.listForCustomer(auth.userId, { limit: 10 });
    const suggestions = searchSuggestions({
      recentCategoryIds: [...new Set(recent.map((j) => j.category_id))],
      categories: catalog.categories,
      lang,
    });

    return {
      query: q ?? '',
      hits: hits.map((h) => ({
        categoryId: h.categoryId,
        skillId: h.skillId,
        label: h.label,
        categoryName: categories.find((c) => c.id === h.categoryId)?.[lang === 'hi' ? 'name_hi' : 'name_en'] ?? '',
        matchedOn: h.matchedOn,
      })),
      suggestions,
    };
  });

  // ---------------------------------------------------------------- what we hold about you
  /**
   * The right of access. Deletion has existed since M1; this has not, and the DPDP Act 2023 does
   * not treat access as optional.
   *
   * The response names every section it included and every one it left out, with the reason -
   * so nobody has to guess whether something is missing by accident or by design.
   */
  app.get('/me/export', { preHandler: requireAction('me.read', { allowSuspended: true }) }, async (req) => {
    const auth = requireAuth(req);
    const userId = auth.userId;

    const [roles, consents, addresses, jobs, invoices, reviews, claims, notifications] = await Promise.all([
      store.users.listRoles(userId),
      store.users.listConsents(userId),
      store.addresses.list(userId),
      store.jobs.listForCustomer(userId, { limit: 500 }),
      store.growth.listInvoices(userId, 500),
      store.finance.listReviewsFor(userId, 200),
      store.trust.listClaimsForCustomer(userId, 200),
      store.notifications.listForUser(userId, 500),
    ]);

    const payments = (await Promise.all(jobs.map((j) => store.payments.listForJob(j.id)))).flat();
    const messages = (
      await Promise.all(
        jobs.map(async (j) => {
          const thread = await store.execution.getThread(j.id);
          return thread ? store.execution.listMessages(thread.id, 500) : [];
        }),
      )
    )
      .flat()
      // Your own words only. A conversation belongs to both sides, and the other person did not
      // ask for their messages to be handed over.
      .filter((m) => m.sender_id === userId);

    const data: Record<string, unknown> = {
      profile: {
        phone: auth.user.phone_e164,
        displayName: auth.user.display_name,
        language: auth.user.preferred_language,
        status: auth.user.status,
        roles: roles.map((r) => ({ role: r.role, status: r.status })),
        joinedAt: auth.user.created_at.toISOString(),
      },
      addresses: addresses.map((a) => ({ label: a.label, line1: a.line1, city: a.city, pincode: a.pincode })),
      consents: consents.map((c) => ({ type: c.consent_type, granted: c.granted, at: c.created_at.toISOString() })),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, description: j.description, createdAt: j.created_at.toISOString() })),
      bookings: jobs.filter((j) => j.confirmed_provider_id).map((j) => ({ jobId: j.id, confirmedAt: j.submitted_at?.toISOString() ?? null })),
      payments: payments.map((p) => ({ jobId: p.job_id, amountPaise: Number(p.amount_paise), status: p.status, at: p.created_at.toISOString() })),
      invoices: invoices.map((i) => ({ number: i.number, totalPaise: Number(i.total_paise), issuedAt: i.issued_at.toISOString() })),
      reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, at: r.created_at.toISOString() })),
      disputes: (await Promise.all(jobs.map((j) => store.finance.listDisputesForJob(j.id)))).flat().map((dsp) => ({
        jobId: dsp.job_id,
        category: dsp.category,
        status: dsp.status,
        at: dsp.created_at.toISOString(),
      })),
      warrantyClaims: claims.map((c) => ({ jobId: c.job_id, status: c.status, at: c.created_at.toISOString() })),
      messages: messages.map((m) => ({ body: m.body, at: m.created_at.toISOString() })),
      notifications: notifications.map((n) => ({ title: n.title, body: n.body, at: n.created_at.toISOString() })),
    };

    const counts = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
    ) as Record<string, number>;

    // Recorded for the same reason a deletion request is: somebody may later ask what they were
    // given and when.
    await store.trust.recordExport({ user_id: userId, status: 'READY', record_counts: counts, requested_at: new Date() });
    await services.audit.record(req.auditCtx(), {
      action: 'user.data_exported',
      entityType: 'user',
      entityId: userId,
      after: counts,
    });

    return {
      generatedAt: new Date().toISOString(),
      sections: EXPORT_SECTIONS,
      exclusions: EXPORT_EXCLUSIONS,
      counts,
      data,
    };
  });

  // ---------------------------------------------------------------- moderation queue
  function requireStaff(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    if (auth.activeRole !== 'ADMIN' && auth.activeRole !== 'SUPPORT') throw forbidden('admin only');
    return auth;
  }

  /**
   * Messages the filter caught, oldest first.
   *
   * These have been flagged since M5 and nobody has ever read one. A flag nobody reads is worse
   * than no flag: it is the appearance of moderation without the fact of it - and the appearance
   * is what we would be relying on if somebody asked how we police off-platform payment.
   */
  app.get('/admin/flagged-messages', async (req) => {
    requireStaff(req);
    const rows = await store.execution.listFlaggedMessages(50);
    const now = new Date();
    const items = await Promise.all(
      rows.map(async (m) => {
        const sender = await store.users.findById(m.sender_id);
        return {
          id: m.id,
          // The thread id is what a reviewer needs to open the conversation; the job it belongs
          // to is one hop away and not worth a repo method that exists only for this screen.
          threadId: m.thread_id,
          body: m.body,
          senderName: sender?.display_name ?? 'Unknown',
          senderId: m.sender_id,
          senderRole: m.sender_party,
          flagReason: m.flag_reason,
          overdue: moderationIsOverdue(m.created_at, now),
          createdAt: m.created_at.toISOString(),
        };
      }),
    );
    return { items, overdue: items.filter((i) => i.overdue).length };
  });

  app.post('/admin/flagged-messages/:id/review', async (req) => {
    const auth = requireStaff(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(ModerateMessageBody, req.body);

    // Most flags are innocent - people share a number so a delivery can be let through the gate.
    // ALLOWED carries no consequence and needs no reason; everything else does.
    if (outcomeNeedsReason(body.outcome) && (body.reason ?? '').trim().length < 5) {
      throw new AppError('VALIDATION_ERROR', { details: { moderation: ['REASON_REQUIRED'] } });
    }

    const message = await store.execution.getMessage(id);
    if (!message) throw notFound('message');
    await store.execution.markMessageReviewed(id, { reviewed_by: auth.userId, review_outcome: body.outcome });

    if (body.outcome === 'WARNED') {
      await store.notifications.create({
        user_id: message.sender_id,
        type: 'account.warning',
        title: 'About a message you sent',
        body: 'Please keep payments and contact inside the app - it is what protects you if something goes wrong.',
        data: {},
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });
    }
    if (outcomeIsPunitive(body.outcome)) {
      await store.finance.addStrike({
        user_id: message.sender_id,
        job_id: null,
        dispute_id: null,
        severity: body.outcome === 'SUSPENDED' ? 'MAJOR' : 'MINOR',
        reason: body.reason ?? 'Off-platform contact',
        issued_by: auth.userId,
        expires_at: null,
      });
    }

    await services.audit.record(req.auditCtx(), {
      action: 'moderation.reviewed',
      entityType: 'chat_message',
      entityId: id,
      reason: body.reason ?? null,
      after: { outcome: body.outcome, senderId: message.sender_id },
    });
    return { ok: true, outcome: body.outcome };
  });

  // ---------------------------------------------------------------- recovery codes
  /**
   * A way back in after a lost phone.
   *
   * Admin MFA has had TOTP, single-use codes and a five-failure lock since M8, and no recovery
   * path at all: losing the phone meant hand-editing production, at speed, under pressure. That
   * is precisely the situation in which somebody makes the mistake that becomes the incident.
   *
   * Shown once. After this we hold only hashes, so we can say a code was accepted and can never
   * say what somebody's codes are.
   */
  app.post('/admin/mfa/recovery-codes', async (req, reply) => {
    const auth = requireStaff(req);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => recoveryCodeFromBytes(randomBytes(8)));
    await store.trust.replaceRecoveryCodes(
      auth.userId,
      codes.map((c) => sha256(`${env.API_JWT_SECRET}:${c}`)),
    );
    await services.audit.record(req.auditCtx(), {
      action: 'admin.recovery_codes_generated',
      entityType: 'user',
      entityId: auth.userId,
      after: { count: codes.length },
    });
    return reply.code(201).send({
      codes: codes.map(formatRecoveryCode),
      generatedAt: new Date().toISOString(),
      warning:
        'Write these down now and keep them somewhere safe. Each works once, and we cannot show them again - we only hold their fingerprints.',
    });
  });

  app.get('/admin/mfa/recovery-codes', async (req) => {
    const auth = requireStaff(req);
    const remaining = await store.trust.listRecoveryCodes(auth.userId);
    // The count, never the codes.
    return { remaining: remaining.length, generatedAt: remaining[0]?.created_at.toISOString() ?? null };
  });

  /** Spending one, when the phone is gone. Burnt on use, whatever happens next. */
  app.post('/admin/mfa/recover', async (req) => {
    const auth = requireStaff(req);
    const { code } = parse(UseRecoveryCodeBody, req.body);
    if (!isPlausibleRecoveryCode(code)) {
      throw new AppError('VALIDATION_ERROR', { details: { recovery: ['BAD_CODE'] } });
    }

    const hash = sha256(`${env.API_JWT_SECRET}:${normaliseRecoveryCode(code)}`);
    const match = (await store.trust.listRecoveryCodes(auth.userId)).find((c) => c.code_hash === hash);
    if (!match) {
      await services.audit.record(req.auditCtx(), {
        action: 'admin.recovery_code_rejected',
        entityType: 'user',
        entityId: auth.userId,
      });
      throw new AppError('VALIDATION_ERROR', { details: { recovery: ['BAD_CODE'] } });
    }

    const ip = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : null;
    await store.trust.burnRecoveryCode(match.id, ip);
    await store.auth.markSessionMfa(auth.sessionId, new Date());
    await services.audit.record(req.auditCtx(), {
      action: 'admin.recovery_code_used',
      entityType: 'user',
      entityId: auth.userId,
      after: { remaining: (await store.trust.listRecoveryCodes(auth.userId)).length },
    });
    return { ok: true, remaining: (await store.trust.listRecoveryCodes(auth.userId)).length };
  });
}
