import type { FastifyInstance } from 'fastify';
import {
  AddTechnicianBody,
  ContractorProfileUpdate,
  TechnicianKycBody,
  type TechnicianView,
} from '@hyperlocal/core';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * A contractor runs a team: they win the work and somebody on their crew does it.
 *
 * The API supported the *result* of that - an assignment can name a technician - but there was
 * no way for a contractor to build a team in the first place. These are the missing routes.
 *
 * Two rules run through all of it:
 *
 * 1. **A technician is added by phone number, never created.** The person must already have an
 *    account - they have signed in at least once on that phone - which proves they hold the
 *    number a customer will be shown. A contractor who could conjure accounts could also create
 *    accounts *as* people, and then send a stranger to somebody's home under a name the customer
 *    had reason to trust. Adding them is what grants the TECHNICIAN role; it is deliberately not
 *    a role anyone can give themselves, because nobody becomes a technician by declaring it.
 * 2. **Verification is the platform's decision, not the contractor's.** A contractor submits
 *    their technician's documents; staff decide. Otherwise "verified" means nothing more than
 *    "their employer says so".
 */
export async function contractorRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store, services } = ctx;

  function requireContractor(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    if (auth.activeRole !== 'CONTRACTOR') throw forbidden('contractors only');
    return auth;
  }

  async function toView(userId: string): Promise<TechnicianView | null> {
    const [user, profile] = await Promise.all([store.users.findById(userId), store.users.getTechnicianProfile(userId)]);
    if (!user || !profile) return null;
    return {
      userId,
      fullName: profile.full_name ?? 'Technician',
      // The contractor sees the whole number: these are their own people, whom they employ.
      phone: user.phone_e164,
      verificationStatus: profile.verification_status,
      skills: profile.skills,
      active: profile.active,
    };
  }

  // ---------------------------------------------------------------- profile
  app.get('/contractor/profile', async (req) => {
    const auth = requireContractor(req);
    const profile = await store.users.getContractorProfile(auth.userId);
    if (!profile) throw notFound('contractor profile');
    const team = await store.users.listTechniciansFor(auth.userId);
    return {
      businessName: profile.business_name,
      verificationStatus: profile.verification_status,
      serviceRadiusKm: profile.service_radius_km,
      teamSize: team.length,
      verifiedTeamSize: team.filter((t) => t.verification_status === 'VERIFIED').length,
    };
  });

  app.put('/contractor/profile', async (req) => {
    const auth = requireContractor(req);
    const body = parse(ContractorProfileUpdate, req.body);
    const existing = await store.users.getContractorProfile(auth.userId);
    const address = body.baseAddressId ? await store.addresses.get(body.baseAddressId) : null;
    if (body.baseAddressId && (!address || address.user_id !== auth.userId)) throw notFound('address');

    const saved = await store.users.upsertContractorProfile({
      user_id: auth.userId,
      business_name: body.businessName,
      // Verification is never something the applicant sets.
      verification_status: existing?.verification_status ?? 'UNVERIFIED',
      base_lat: address?.lat ?? existing?.base_lat ?? null,
      base_lng: address?.lng ?? existing?.base_lng ?? null,
      service_radius_km: body.serviceRadiusKm ?? existing?.service_radius_km ?? 5,
    });
    return { businessName: saved.business_name, verificationStatus: saved.verification_status, serviceRadiusKm: saved.service_radius_km };
  });

  // ---------------------------------------------------------------- the team
  app.get('/contractor/technicians', async (req) => {
    const auth = requireContractor(req);
    const team = await store.users.listTechniciansFor(auth.userId);
    const items = (await Promise.all(team.map((t) => toView(t.user_id)))).filter((t): t is TechnicianView => !!t);
    return { items };
  });

  /**
   * Adding somebody to the team.
   *
   * The person must already have an account on this number, and adding them grants the
   * TECHNICIAN role. That hurdle is the point: every technician on this platform has proved
   * they hold the number a customer will be shown, and nobody is added to a crew silently -
   * they are told the moment it happens.
   */
  app.post('/contractor/technicians', async (req, reply) => {
    const auth = requireContractor(req);
    const body = parse(AddTechnicianBody, req.body);

    const person = await store.users.findByPhone(body.phone);
    if (!person) {
      throw new AppError('VALIDATION_ERROR', {
        details: {
          contractor: ['TECHNICIAN_NOT_REGISTERED'],
          message: 'Ask them to install the app and sign in with this number first, then add them again.',
        },
      });
    }
    if (person.id === auth.userId) {
      throw new AppError('VALIDATION_ERROR', { details: { contractor: ['CANNOT_ADD_YOURSELF'] } });
    }

    const existing = await store.users.getTechnicianProfile(person.id);
    if (existing?.contractor_id && existing.contractor_id !== auth.userId) {
      // Somebody cannot be on two crews at once: a customer has to be able to tell who is
      // answerable for the person at their door.
      throw new AppError('CONFLICT', { details: { contractor: ['ALREADY_ON_ANOTHER_TEAM'] } });
    }

    // Granting the role is the act of adding them, and the grant records who did it.
    // TECHNICIAN is not self-service precisely so that this is the only way in.
    await store.users.grantRole({ user_id: person.id, role: 'TECHNICIAN', granted_by: auth.userId });

    await store.users.upsertTechnicianProfile({
      user_id: person.id,
      contractor_id: auth.userId,
      full_name: body.fullName,
      // Added is not verified. Staff decide that, on documents, later.
      verification_status: existing?.verification_status ?? 'UNVERIFIED',
      skills: body.skills ?? existing?.skills ?? [],
      active: true,
    });

    await store.notifications.create({
      user_id: person.id,
      type: 'account.team_joined',
      title: 'You were added to a team',
      body: 'A contractor added you to their crew. Switch to the Technician role to see their jobs once you are verified.',
      data: {},
      channel: 'IN_APP',
      read_at: null,
      sent_at: new Date(),
    });

    await services.audit.record(req.auditCtx(), {
      action: 'contractor.technician_added',
      entityType: 'user',
      entityId: person.id,
      after: { contractorId: auth.userId },
    });
    return reply.code(201).send({ technician: await toView(person.id) });
  });

  /** Taking somebody off the crew. The profile is kept, so their history stays theirs. */
  app.delete('/contractor/technicians/:id', async (req) => {
    const auth = requireContractor(req);
    const { id } = parse(IdParam, req.params);
    const profile = await store.users.getTechnicianProfile(id);
    if (!profile || profile.contractor_id !== auth.userId) throw notFound('technician');

    await store.users.upsertTechnicianProfile({ ...profile, active: false });
    await services.audit.record(req.auditCtx(), {
      action: 'contractor.technician_removed',
      entityType: 'user',
      entityId: id,
      after: { contractorId: auth.userId },
    });
    return { ok: true };
  });

  /**
   * Submitting a technician's identity documents for review.
   *
   * The contractor never sees the result as a decision they can make: this puts the person in
   * the same queue every other applicant goes through (PRODUCT_SPEC section 15).
   */
  app.post('/contractor/technicians/:id/kyc', async (req, reply) => {
    const auth = requireContractor(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(TechnicianKycBody, req.body);

    const profile = await store.users.getTechnicianProfile(id);
    if (!profile || profile.contractor_id !== auth.userId || !profile.active) throw notFound('technician');

    // Submitted against the technician's own user id: the document belongs to them, and the
    // review queue treats it exactly like any other applicant's.
    const { record, upload, uploadRequired } = await services.provider.submitKyc(id, body);

    await store.users.upsertTechnicianProfile({ ...profile, verification_status: 'SUBMITTED' });
    await services.audit.record(req.auditCtx(), {
      action: 'contractor.technician_kyc_submitted',
      entityType: 'kyc_record',
      entityId: record.id,
      // The document type, never the number - here or anywhere else.
      after: { technicianId: id, documentType: body.documentType },
    });
    return reply.code(201).send({
      kyc: { id: record.id, status: record.status },
      upload: { url: upload.url, method: upload.method, expiresAt: upload.expiresAt.toISOString(), required: uploadRequired },
    });
  });

  // ---------------------------------------------------------------- the crew's work
  /**
   * Every live job this contractor won, and who is on it. This is the screen a contractor runs
   * their day from, so it says plainly which jobs still have nobody assigned.
   */
  app.get('/contractor/jobs', async (req) => {
    const auth = requireContractor(req);
    const assignments = await store.negotiation.listAssignmentsForProvider(auth.userId, 50);
    const categories = await store.categories.listEnabled();

    const items = await Promise.all(
      assignments.map(async (a) => {
        const job = await store.jobs.get(a.job_id);
        if (!job) return null;
        const tech = a.technician_id ? await toView(a.technician_id) : null;
        const snapshot = job.address_snapshot as { societyName?: string; city?: string } | null;
        return {
          jobId: job.id,
          status: job.status,
          categoryName: categories.find((c) => c.id === job.category_id)?.name_en ?? 'Service',
          areaLabel: snapshot?.societyName ?? snapshot?.city ?? 'Nearby',
          preferredStart: job.preferred_start?.toISOString() ?? null,
          technician: tech ? { userId: tech.userId, fullName: tech.fullName } : null,
          /** The thing a contractor is looking for when they open this screen. */
          needsTechnician: !a.technician_id,
        };
      }),
    );
    return { items: items.filter((i): i is NonNullable<typeof i> => !!i) };
  });
}
